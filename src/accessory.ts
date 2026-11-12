import type { API, CharacteristicValue, Logging, PlatformAccessory, Service } from 'homebridge'

import type { LocalRobot } from 'dorita980'

import dorita980 from 'dorita980'

import {
  applyCleaningPasses,
  cleanModeFromNumber,
  matterRoomAreas,
  RUN_MODE_CLEANING,
  RUN_MODE_IDLE,
  startMission,
} from './mission.js'
import { buildMatterDefinition, phaseIsCleaning, phaseToOperational } from './matterVacuum.js'
import { publicSerial, safeError } from './redact.js'
import { sanitizeDevice } from './discoveryPlan.js'
import type { CleanMode, DeviceConfig } from './settings.js'

export type RobotFactory = (
  blid: string,
  password: string,
  ip: string,
  onError: (error: unknown) => void,
) => LocalRobot

export interface MatterBridge {
  uuid?: { generate: (value: string) => string }
  deviceTypes?: { RoboticVacuumCleaner?: unknown }
  updateAccessoryState?: (uuid: string, cluster: string, attributes: Record<string, unknown>) => Promise<void>
}

function defaultRobotFactory(blid: string, password: string, ip: string, onError: (error: unknown) => void): LocalRobot {
  return new dorita980.Local(blid, password, ip, 2, { onError })
}

export class RoombaAccessory {
  private readonly robot: LocalRobot
  private readonly vacuumService: Service
  private readonly dockService: Service
  private readonly batteryService: Service
  private readonly binSensorService: Service
  private statePollInterval?: ReturnType<typeof setInterval>
  private cleanMode: CleanMode
  private selectedRoomIds: string[]
  readonly matterUuid?: string

  constructor(
    private readonly log: Logging,
    private readonly api: API,
    private readonly accessory: PlatformAccessory,
    private device: DeviceConfig,
    options?: { robotFactory?: RobotFactory, matter?: MatterBridge },
  ) {
    this.device = sanitizeDevice(device)
    const { blid, robotpwd, ipaddress, name } = this.device
    const factory = options?.robotFactory ?? defaultRobotFactory
    this.robot = factory(blid, robotpwd, ipaddress, (error) => {
      this.log.error(`${this.device.name}: local connection error — ${safeError(error, [this.device.robotpwd, this.device.blid])}`)
    })
    this.cleanMode = this.device.cleanMode ?? 'automatic'
    this.selectedRoomIds = (this.device.rooms ?? []).filter(room => room.selected).map(room => room.id)
    const matter = options?.matter
    this.matter = matter
    const matterSeed = publicSerial(blid)
    this.matterUuid = matter?.uuid?.generate(matterSeed) ?? this.api.hap.uuid.generate(matterSeed)

    this.vacuumService = this.service(this.api.hap.Service.Fan, name, 'vacuum')
    this.vacuumService
      .getCharacteristic(this.api.hap.Characteristic.On)
      .onSet(value => this.handleActiveSet(value))

    this.dockService = this.service(this.api.hap.Service.Switch, `${name} Dock`, 'dock')
    this.dockService
      .getCharacteristic(this.api.hap.Characteristic.On)
      .onSet(value => this.handleDockSet(value))

    this.batteryService = this.service(this.api.hap.Service.Battery, name, 'battery')
    this.binSensorService = this.service(this.api.hap.Service.ContactSensor, `${name} Bin`, 'bin')

    if (typeof this.robot.getRobotState === 'function') {
      this.log.info(`${this.device.name}: Advanced state polling enabled.`)
      void this.fetchHybridState()
      this.statePollInterval = setInterval(() => {
        void this.fetchHybridState()
      }, 60_000)
    }
    else if (typeof this.robot.getStatus === 'function') {
      this.log.info(`${this.device.name}: Legacy state polling enabled.`)
      void this.fetchLegacyState()
      this.statePollInterval = setInterval(() => {
        void this.fetchLegacyState()
      }, 60_000)
    }
    else {
      this.log.warn(`${this.device.name}: No state polling supported on this model.`)
    }
    this.statePollInterval?.unref?.()
  }

  private matter?: MatterBridge

  private service(type: any, name: string, subtype: string): Service {
    return this.accessory.getServiceById(type, subtype) ?? this.accessory.addService(type, name, subtype)
  }

  async handleActiveSet(value: CharacteristicValue): Promise<void> {
    try {
      if (value) {
        this.log.info(`${this.device.name}: Starting cleaning`)
        await this.startSelectedClean()
      }
      else {
        this.log.info(`${this.device.name}: Stopping cleaning`)
        await this.robot.stop()
      }
    }
    catch (error) {
      this.log.error(`${this.device.name}: Vacuum command failed — ${safeError(error, [this.device.robotpwd, this.device.blid])}`)
    }
  }

  async handleDockSet(value: CharacteristicValue): Promise<void> {
    try {
      if (value) {
        this.log.info(`${this.device.name}: Sending to dock`)
        await this.robot.dock()
      }
    }
    catch (error) {
      this.log.error(`${this.device.name}: Dock command failed — ${safeError(error, [this.device.robotpwd, this.device.blid])}`)
    }
  }

  async startSelectedClean(): Promise<'rooms' | 'everywhere'> {
    const result = await startMission(this.robot, {
      mode: this.cleanMode,
      pmapId: this.device.pmapId,
      userPmapvId: this.device.userPmapvId,
      rooms: this.device.rooms ?? [],
      selectedRoomIds: this.selectedRoomIds,
    })
    if (result === 'rooms') {
      this.log.info(`${this.device.name}: Started a room mission`)
    }
    return result
  }

  async setCleanMode(mode: CleanMode): Promise<void> {
    this.cleanMode = mode
    await applyCleaningPasses(this.robot, mode)
  }

  async fetchHybridState(): Promise<void> {
    if (!this.robot.getRobotState) {
      return
    }
    try {
      const state = await this.robot.getRobotState(['batPct', 'bin', 'cleanMissionStatus'])
      const battery = numberOrZero(state.batPct)
      const mission = state.cleanMissionStatus as { phase?: string } | undefined
      const phase = mission?.phase
      const charging = phase === 'charge'
      const bin = state.bin as { full?: boolean } | undefined
      const binFull = Boolean(bin?.full ?? false)
      this.updateCharacteristics(battery, charging, binFull)
      this.syncFan(phaseIsCleaning(phase))
      await this.pushMatter(battery, charging, phase)
    }
    catch (error) {
      this.log.error(`${this.device.name}: Hybrid state fetch failed — ${safeError(error, [this.device.robotpwd, this.device.blid])}`)
    }
  }

  async fetchLegacyState(): Promise<void> {
    if (!this.robot.getStatus) {
      return
    }
    try {
      const state = await this.robot.getStatus()
      const battery = numberOrZero(state.battery)
      const charging = Boolean(state.charging)
      const binFull = Boolean(state.binFull ?? false)
      this.updateCharacteristics(battery, charging, binFull)
      await this.pushMatter(battery, charging, charging ? 'charge' : undefined)
    }
    catch (error) {
      this.log.error(`${this.device.name}: Legacy state fetch failed — ${safeError(error, [this.device.robotpwd, this.device.blid])}`)
    }
  }

  updateCharacteristics(battery: number, charging: boolean, binFull: boolean): void {
    this.batteryService.setCharacteristic(this.api.hap.Characteristic.BatteryLevel, battery)
    this.batteryService.setCharacteristic(
      this.api.hap.Characteristic.ChargingState,
      charging
        ? this.api.hap.Characteristic.ChargingState.CHARGING
        : this.api.hap.Characteristic.ChargingState.NOT_CHARGING,
    )
    this.binSensorService.setCharacteristic(
      this.api.hap.Characteristic.ContactSensorState,
      binFull
        ? this.api.hap.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
        : this.api.hap.Characteristic.ContactSensorState.CONTACT_DETECTED,
    )
  }

  buildMatterDefinition(deviceType: unknown): ReturnType<typeof buildMatterDefinition> | undefined {
    if (!this.matterUuid) {
      return undefined
    }
    return buildMatterDefinition({
      uuid: this.matterUuid,
      name: this.device.name,
      serialNumber: publicSerial(this.device.blid),
      deviceType,
      model: this.device.model,
      firmwareRevision: this.device.softwareVer,
      cleanMode: this.cleanMode,
      rooms: this.device.rooms ?? [],
      selectedRoomIds: this.selectedRoomIds,
      handlers: {
        changeCleanMode: async (request) => {
          const mode = cleanModeFromNumber(request.newMode ?? -1)
          if (!mode) {
            throw new Error('Unsupported clean mode')
          }
          this.log.info(`${this.device.name}: Clean mode ${mode}`)
          await this.setCleanMode(mode)
        },
        changeRunMode: async (request) => {
          if (request.newMode === RUN_MODE_CLEANING) {
            await this.startSelectedClean()
            return
          }
          if (request.newMode === RUN_MODE_IDLE) {
            await this.robot.stop()
            return
          }
          throw new Error('Unsupported run mode')
        },
        selectAreas: async (request) => {
          const areas = matterRoomAreas(this.device.rooms ?? [])
          const requested = request.newAreas ?? []
          const roomIds: string[] = []
          for (const areaId of requested) {
            const area = areas.find(candidate => candidate.areaId === areaId)
            if (!area) {
              throw new Error('Unknown room selection')
            }
            roomIds.push(area.roomId)
          }
          this.selectedRoomIds = roomIds
          this.log.info(`${this.device.name}: Selected ${roomIds.length} room(s)`)
        },
        pause: async () => {
          if (this.robot.pause) {
            await this.robot.pause()
            return
          }
          await this.robot.stop()
        },
        resume: async () => {
          await this.startSelectedClean()
        },
        goHome: async () => {
          this.log.info(`${this.device.name}: Sending to dock`)
          await this.robot.dock()
        },
        identify: async () => {
          if (this.robot.find) {
            this.log.info(`${this.device.name}: Playing locate tone`)
            await this.robot.find()
          }
        },
      },
    })
  }

  dispose(): void {
    if (this.statePollInterval) {
      clearInterval(this.statePollInterval)
      this.statePollInterval = undefined
    }
    try {
      this.robot.end?.()
    }
    catch {
      // Disconnect errors are not actionable here.
    }
  }

  private syncFan(cleaning: boolean): void {
    const service = this.vacuumService as Service & {
      updateCharacteristic?: (characteristic: unknown, value: CharacteristicValue) => void
    }
    if (service.updateCharacteristic) {
      service.updateCharacteristic(this.api.hap.Characteristic.On, cleaning)
      return
    }
    service.setCharacteristic(this.api.hap.Characteristic.On, cleaning)
  }

  private async pushMatter(battery: number, charging: boolean, phase: string | undefined): Promise<void> {
    if (!this.matter?.updateAccessoryState || !this.matterUuid) {
      return
    }
    const percent = Math.max(0, Math.min(200, Math.round(battery * 2)))
    try {
      await this.matter.updateAccessoryState(this.matterUuid, 'powerSource', {
        batPercentRemaining: percent,
        batChargeLevel: battery <= 15 ? 1 : 0,
      })
      await this.matter.updateAccessoryState(this.matterUuid, 'rvcOperationalState', {
        operationalState: phaseToOperational(phase, charging),
      })
      await this.matter.updateAccessoryState(this.matterUuid, 'rvcRunMode', {
        currentMode: phaseIsCleaning(phase) ? RUN_MODE_CLEANING : RUN_MODE_IDLE,
      })
    }
    catch (error) {
      this.log.error(`${this.device.name}: Matter state update failed — ${safeError(error, [this.device.robotpwd, this.device.blid])}`)
    }
  }
}

function numberOrZero(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) {
    return 0
  }
  return Math.max(0, Math.min(100, Math.round(parsed)))
}
