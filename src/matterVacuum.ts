import type { MatterAccessory } from 'homebridge'

import type { CleanMode, RoomConfig } from './settings.js'

import {
  assertSupportedModeCount,
  matterRoomAreas,
  modeNumber,
  RVC_CLEAN_MODES,
  RVC_RUN_MODES,
  RUN_MODE_IDLE,
  type MatterRoomArea,
} from './mission.js'

export const RVC_OPERATIONAL = {
  STOPPED: 0,
  RUNNING: 1,
  PAUSED: 2,
  ERROR: 3,
  SEEKING_CHARGER: 64,
  CHARGING: 65,
  DOCKED: 66,
} as const

export function phaseToOperational(phase: string | undefined, charging: boolean): number {
  switch (phase) {
    case 'run':
    case 'evac':
      return RVC_OPERATIONAL.RUNNING
    case 'pause':
    case 'paused':
      return RVC_OPERATIONAL.PAUSED
    case 'stuck':
    case 'error':
      return RVC_OPERATIONAL.ERROR
    case 'hmPostMsn':
    case 'hmUsrDock':
    case 'dock':
    case 'docking':
      return RVC_OPERATIONAL.SEEKING_CHARGER
    case 'charge':
      return charging ? RVC_OPERATIONAL.CHARGING : RVC_OPERATIONAL.DOCKED
    default:
      return charging ? RVC_OPERATIONAL.CHARGING : RVC_OPERATIONAL.STOPPED
  }
}

export function phaseIsCleaning(phase: string | undefined): boolean {
  return phase === 'run' || phase === 'evac' || phase === 'pause' || phase === 'paused'
}

export function rvcCleanModeCluster(mode: CleanMode): {
  supportedModes: typeof RVC_CLEAN_MODES
  currentMode: number
} {
  assertSupportedModeCount(RVC_CLEAN_MODES)
  return {
    supportedModes: RVC_CLEAN_MODES,
    currentMode: modeNumber(mode),
  }
}

export interface HomebridgeMatterApi {
  uuid?: { generate: (value: string) => string }
  deviceTypes?: { RoboticVacuumCleaner?: unknown }
  registerPlatformAccessories?: (plugin: string, platform: string, accessories: MatterAccessory[]) => Promise<void>
  updateAccessoryState?: (uuid: string, cluster: string, attributes: Record<string, unknown>) => Promise<void>
}

type ClusterHandler = (...args: unknown[]) => Promise<void>

function modeRequest(value: unknown): { newMode?: number } {
  if (!value || typeof value !== 'object' || !('newMode' in value)) {
    return {}
  }
  const mode = value.newMode
  return { newMode: typeof mode === 'number' ? mode : undefined }
}

function areaRequest(value: unknown): { newAreas?: number[] } {
  if (!value || typeof value !== 'object' || !('newAreas' in value)) {
    return {}
  }
  const areas = value.newAreas
  if (!Array.isArray(areas)) {
    return {}
  }
  return { newAreas: areas.filter((area): area is number => typeof area === 'number') }
}

export interface MatterVacuumHandlers {
  changeCleanMode: (request: { newMode?: number }) => Promise<void>
  changeRunMode: (request: { newMode?: number }) => Promise<void>
  selectAreas: (request: { newAreas?: number[] }) => Promise<void>
  pause: () => Promise<void>
  resume: () => Promise<void>
  goHome: () => Promise<void>
  identify?: () => Promise<void>
}

export function buildMatterDefinition(input: {
  uuid: string
  name: string
  serialNumber: string
  deviceType: unknown
  model?: string
  firmwareRevision?: string
  cleanMode: CleanMode
  rooms: RoomConfig[]
  selectedRoomIds: string[]
  handlers: MatterVacuumHandlers
}): {
  UUID: string
  displayName: string
  name: string
  deviceType: unknown
  serialNumber: string
  manufacturer: string
  model: string
  firmwareRevision: string
  hardwareRevision: string
  context: Record<string, never>
  clusters: Record<string, unknown>
  handlers: Record<string, Record<string, ClusterHandler>>
  areas: MatterRoomArea[]
} {
  const cleanMode = rvcCleanModeCluster(input.cleanMode)
  const areas = matterRoomAreas(input.rooms)
  const selected = new Set(input.selectedRoomIds)
  const clusters: Record<string, unknown> = {
    powerSource: {
      status: 0,
      order: 0,
      description: 'Battery',
      batPercentRemaining: 0,
      batChargeLevel: 0,
      batReplaceability: 1,
    },
    rvcRunMode: {
      supportedModes: RVC_RUN_MODES,
      currentMode: RUN_MODE_IDLE,
    },
    rvcCleanMode: cleanMode,
    rvcOperationalState: {
      operationalStateList: [
        { operationalStateId: RVC_OPERATIONAL.STOPPED },
        { operationalStateId: RVC_OPERATIONAL.RUNNING },
        { operationalStateId: RVC_OPERATIONAL.PAUSED },
        { operationalStateId: RVC_OPERATIONAL.ERROR },
        { operationalStateId: RVC_OPERATIONAL.SEEKING_CHARGER },
        { operationalStateId: RVC_OPERATIONAL.CHARGING },
        { operationalStateId: RVC_OPERATIONAL.DOCKED },
      ],
      operationalState: RVC_OPERATIONAL.DOCKED,
    },
  }
  const handlers: Record<string, Record<string, ClusterHandler>> = {
    identify: {
      identify: async () => {
        await input.handlers.identify?.()
      },
    },
    rvcCleanMode: {
      changeToMode: async request => input.handlers.changeCleanMode(modeRequest(request)),
    },
    rvcRunMode: {
      changeToMode: async request => input.handlers.changeRunMode(modeRequest(request)),
    },
    rvcOperationalState: {
      pause: async () => input.handlers.pause(),
      resume: async () => input.handlers.resume(),
      goHome: async () => input.handlers.goHome(),
    },
  }
  if (areas.length > 0) {
    clusters.serviceArea = {
      supportedAreas: areas.map(area => ({
        areaId: area.areaId,
        mapId: null,
        areaInfo: {
          locationInfo: {
            locationName: area.name,
            floorNumber: 0,
            areaType: 0,
          },
          landmarkInfo: null,
        },
      })),
      selectedAreas: areas.filter(area => selected.has(area.roomId)).map(area => area.areaId),
    }
    handlers.serviceArea = {
      selectAreas: async request => input.handlers.selectAreas(areaRequest(request)),
    }
  }
  return {
    UUID: input.uuid,
    displayName: input.name,
    // Homebridge uses `name` for the Matter node label while pairing.
    name: input.name,
    deviceType: input.deviceType,
    serialNumber: input.serialNumber,
    manufacturer: 'iRobot',
    model: input.model || 'Roomba',
    firmwareRevision: input.firmwareRevision || '0.0.0',
    hardwareRevision: '',
    context: {},
    clusters,
    handlers,
    areas,
  }
}
