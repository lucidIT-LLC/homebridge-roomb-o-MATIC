import type { API, Logging, PlatformAccessory, Service } from 'homebridge'

import { describe, expect, it, vi } from 'vitest'

import { RoombaAccessory, type RobotFactory } from './accessory.js'
import { getRoombas } from './roomba.js'
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js'
import type { DeviceConfig } from './settings.js'

const On = { name: 'On' }
const BatteryLevel = { name: 'BatteryLevel' }
const ChargingState = { name: 'ChargingState', CHARGING: 1, NOT_CHARGING: 0 }
const ContactSensorState = { name: 'Contact', CONTACT_DETECTED: 0, CONTACT_NOT_DETECTED: 1 }

class FakeService {
  readonly characteristics = new Map<unknown, { value?: unknown, setHandler?: (value: unknown) => unknown, onSet: (cb: (value: unknown) => unknown) => unknown }>()

  constructor(public displayName?: string, public subtype?: string) {}

  getCharacteristic(type: unknown) {
    let characteristic = this.characteristics.get(type)
    if (!characteristic) {
      characteristic = {
        onSet: (callback) => {
          characteristic!.setHandler = callback
          return characteristic
        },
      }
      this.characteristics.set(type, characteristic)
    }
    return characteristic
  }

  setCharacteristic(type: unknown, value: unknown) {
    this.getCharacteristic(type).value = value
    return this
  }

  updateCharacteristic(type: unknown, value: unknown) {
    return this.setCharacteristic(type, value)
  }
}

function fakeApi(): API {
  const hap = {
    uuid: { generate: (value: string) => `uuid:${value}` },
    Categories: { FAN: 3 },
    Service: {
      Fan: FakeService,
      Switch: FakeService,
      Battery: FakeService,
      ContactSensor: FakeService,
    },
    Characteristic: { On, BatteryLevel, ChargingState, ContactSensorState },
  }
  return { hap } as unknown as API
}

function fakeAccessory(): PlatformAccessory {
  const services: FakeService[] = []
  return {
    displayName: 'Roomba',
    UUID: 'uuid:test',
    context: {},
    getServiceById: (_type: unknown, subtype: string) => services.find(service => service.subtype === subtype),
    addService: (_type: new (name?: string, subtype?: string) => FakeService, name?: string, subtype?: string) => {
      const service = new FakeService(name, subtype)
      services.push(service)
      return service as unknown as Service
    },
    services,
  } as unknown as PlatformAccessory
}

function logger(): Logging & { lines: string[] } {
  const lines: string[] = []
  const write = (line: string) => {
    lines.push(line)
  }
  return {
    lines,
    info: write,
    warn: write,
    error: write,
    debug: write,
    log: write,
  } as unknown as Logging & { lines: string[] }
}

const device: DeviceConfig = {
  name: 'Hall Robot',
  blid: 'BLIDSECRET',
  robotpwd: 'PWDSECRET',
  ipaddress: '192.0.2.10',
}

describe('v1.2.1 behavior', () => {
  it('keeps the platform name existing configs already use', () => {
    expect(PLATFORM_NAME).toBe('Roomb-O-Matic')
    expect(PLUGIN_NAME).toBe('homebridge-roomb-o-matic')
  })

  it('normalizes configured robots and does not log the blid or password', async () => {
    const log = logger()
    const robots = await getRoombas([device], log)
    expect(robots).toEqual([device])
    expect(log.lines.join('\n')).not.toContain('BLIDSECRET')
    expect(log.lines.join('\n')).not.toContain('PWDSECRET')
    const mapped = await getRoombas({ one: device }, log)
    expect(mapped).toEqual([device])
  })

  it('exposes a Fan, dock switch, battery, and bin sensor and drives start, stop, and dock', async () => {
    const robot = {
      start: vi.fn(async () => ({ ok: null })),
      stop: vi.fn(async () => ({ ok: null })),
      dock: vi.fn(async () => ({ ok: null })),
      getRobotState: vi.fn(async () => ({
        batPct: 42,
        bin: { full: true },
        cleanMissionStatus: { phase: 'charge' },
      })),
      end: vi.fn(),
    }
    const factory: RobotFactory = () => robot
    const accessory = fakeAccessory()
    const session = new RoombaAccessory(logger(), fakeApi(), accessory, device, { robotFactory: factory })
    const services = (accessory as unknown as { services: FakeService[] }).services
    expect(services.map(service => service.subtype)).toEqual(['vacuum', 'dock', 'battery', 'bin'])

    await session.handleActiveSet(true)
    await session.handleActiveSet(false)
    await session.handleDockSet(true)
    expect(robot.start).toHaveBeenCalledOnce()
    expect(robot.stop).toHaveBeenCalledOnce()
    expect(robot.dock).toHaveBeenCalledOnce()

    await session.fetchHybridState()
    expect(robot.getRobotState).toHaveBeenCalledWith(['batPct', 'bin', 'cleanMissionStatus'])
    const battery = services.find(service => service.subtype === 'battery')!
    const bin = services.find(service => service.subtype === 'bin')!
    expect(battery.getCharacteristic(BatteryLevel).value).toBe(42)
    expect(battery.getCharacteristic(ChargingState).value).toBe(ChargingState.CHARGING)
    expect(bin.getCharacteristic(ContactSensorState).value).toBe(ContactSensorState.CONTACT_NOT_DETECTED)
    session.dispose()
  })

  it('maps selected rooms onto a cleanRoom mission', async () => {
    const robot = {
      start: vi.fn(async () => ({ ok: null })),
      stop: vi.fn(async () => ({ ok: null })),
      dock: vi.fn(async () => ({ ok: null })),
      cleanRoom: vi.fn(async () => ({ ok: null })),
      setCleaningPassesTwo: vi.fn(async () => ({ ok: null })),
      getRobotState: vi.fn(async () => ({ batPct: 80, bin: { full: false }, cleanMissionStatus: { phase: 'stop' } })),
      end: vi.fn(),
    }
    const session = new RoombaAccessory(logger(), fakeApi(), fakeAccessory(), {
      ...device,
      cleanMode: 'deep',
      pmapId: 'pmap-1',
      userPmapvId: 'ver-1',
      rooms: [{ id: '5', name: 'Hall', selected: true }],
    }, { robotFactory: () => robot })
    await session.handleActiveSet(true)
    expect(robot.setCleaningPassesTwo).toHaveBeenCalledOnce()
    expect(robot.cleanRoom).toHaveBeenCalledWith({
      ordered: 1,
      pmap_id: 'pmap-1',
      user_pmapv_id: 'ver-1',
      regions: [{ region_id: '5', region_name: 'Hall', type: 'rid' }],
      twoPass: true,
      noAutoPasses: true,
    })
    expect(robot.start).not.toHaveBeenCalled()
    session.dispose()
  })

  it('uses legacy getStatus when getRobotState is absent', async () => {
    const robot = {
      start: vi.fn(async () => ({ ok: null })),
      stop: vi.fn(async () => ({ ok: null })),
      dock: vi.fn(async () => ({ ok: null })),
      getStatus: vi.fn(async () => ({ battery: 15, charging: false, binFull: false })),
      end: vi.fn(),
    }
    const accessory = fakeAccessory()
    const session = new RoombaAccessory(logger(), fakeApi(), accessory, device, { robotFactory: () => robot })
    await session.fetchLegacyState()
    const services = (accessory as unknown as { services: FakeService[] }).services
    const battery = services.find(service => service.subtype === 'battery')!
    expect(battery.getCharacteristic(BatteryLevel).value).toBe(15)
    expect(battery.getCharacteristic(ChargingState).value).toBe(ChargingState.NOT_CHARGING)
    session.dispose()
  })
})
