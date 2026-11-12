import type { API, Logging, PlatformAccessory } from 'homebridge'

import { describe, expect, it, vi } from 'vitest'

import { RoombOMaticPlatform } from './platform.js'
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js'
import type { DeviceConfig } from './settings.js'

class FakeService {
  constructor(public displayName?: string, public subtype?: string) {}
  getCharacteristic() {
    return { onSet: () => this }
  }
  setCharacteristic() {
    return this
  }
  updateCharacteristic() {
    return this
  }
}

function fakeLogger(): Logging {
  const write = () => undefined
  return { info: write, warn: write, error: write, debug: write, log: write } as unknown as Logging
}

function fakeApi(matter = false) {
  const registered: Array<{ plugin: string, platform: string, accessories: unknown[] }> = []
  const matterRegistered: unknown[] = []
  const unregistered: unknown[] = []
  const hap = {
    uuid: { generate: (value: string) => `uuid:${value}` },
    Categories: { FAN: 3 },
    Service: { Fan: FakeService, Switch: FakeService, Battery: FakeService, ContactSensor: FakeService },
    Characteristic: {
      On: { name: 'On' },
      BatteryLevel: { name: 'BatteryLevel' },
      ChargingState: { name: 'ChargingState', CHARGING: 1, NOT_CHARGING: 0 },
      ContactSensorState: { name: 'Contact', CONTACT_DETECTED: 0, CONTACT_NOT_DETECTED: 1 },
    },
  }
  class Accessory {
    context: Record<string, unknown> = {}
    category?: number
    services: FakeService[] = []
    constructor(public displayName: string, public UUID: string) {}
    getServiceById(_type: unknown, subtype: string) {
      return this.services.find(service => service.subtype === subtype)
    }
    addService(_type: new (name?: string, subtype?: string) => FakeService, name?: string, subtype?: string) {
      const service = new FakeService(name, subtype)
      this.services.push(service)
      return service
    }
  }
  const api = {
    hap,
    platformAccessory: Accessory,
    on: () => undefined,
    registerPlatformAccessories: (plugin: string, platform: string, accessories: unknown[]) => {
      registered.push({ plugin, platform, accessories })
    },
    unregisterPlatformAccessories: (...args: unknown[]) => {
      unregistered.push(args)
    },
    updatePlatformAccessories: () => undefined,
    matter: matter
      ? {
          uuid: { generate: (value: string) => `matter:${value}` },
          deviceTypes: { RoboticVacuumCleaner: { name: 'RoboticVacuumCleaner' } },
          registerPlatformAccessories: vi.fn(async (_plugin: string, _platform: string, accessories: unknown[]) => {
            matterRegistered.push(...accessories)
          }),
          updateAccessoryState: vi.fn(async () => undefined),
        }
      : undefined,
  }
  return { api: api as unknown as API, registered, matterRegistered, unregistered, Accessory }
}

const device: DeviceConfig = {
  name: 'Roomba',
  blid: 'LOCALBLID',
  robotpwd: 'LOCALPWD',
  ipaddress: '192.0.2.10',
  rooms: [{ id: '1', name: 'Kitchen', selected: true }],
  pmapId: 'pmap-1',
  userPmapvId: 'ver-1',
}

describe('platform discovery', () => {
  it('registers a HomeKit Fan under Roomb-O-Matic and does not call cloud login', async () => {
    const { api, registered, unregistered } = fakeApi()
    const discoverCloud = vi.fn(async () => ({ ok: true, robots: [] }))
    const platform = new RoombOMaticPlatform(fakeLogger(), {
      platform: PLATFORM_NAME,
      email: 'person@example.com',
      password: 'account-secret',
      devices: [device],
    }, api, {
      discoverCloud,
      robotFactory: () => ({
        start: async () => undefined,
        stop: async () => undefined,
        dock: async () => undefined,
        getRobotState: async () => ({ batPct: 10, bin: { full: false }, cleanMissionStatus: { phase: 'stop' } }),
        end: () => undefined,
      }),
    })
    await platform.discoverDevices()
    expect(discoverCloud).not.toHaveBeenCalled()
    expect(unregistered).toEqual([])
    expect(registered).toEqual([{
      plugin: PLUGIN_NAME,
      platform: PLATFORM_NAME,
      accessories: [expect.objectContaining({ displayName: 'Roomba', category: 3 })],
    }])
    platform.shutdown()
  })

  it('keeps a cached accessory when cloud discovery fails', async () => {
    const { api, unregistered, Accessory } = fakeApi()
    const platform = new RoombOMaticPlatform(fakeLogger(), {
      platform: PLATFORM_NAME,
      email: 'person@example.com',
      password: 'account-secret',
    }, api, {
      discoverCloud: async () => ({ ok: false, robots: [], status: 403 }),
      robotFactory: () => ({
        start: async () => undefined,
        stop: async () => undefined,
        dock: async () => undefined,
        end: () => undefined,
      }),
    })
    const cached = new Accessory('Cached Roomba', 'uuid:cached-blid') as unknown as PlatformAccessory
    cached.context.device = {
      name: 'Cached Roomba',
      blid: 'cached-blid',
      robotpwd: 'cached-secret',
      ipaddress: '192.0.2.20',
    }
    platform.configureAccessory(cached)
    await platform.discoverDevices()
    expect(unregistered).toEqual([])
    expect((platform as unknown as { sessions: Map<string, unknown> }).sessions.size).toBe(1)
    platform.shutdown()
  })

  it('publishes Matter clean modes without removing the HomeKit accessory', async () => {
    const { api, registered, matterRegistered } = fakeApi(true)
    const platform = new RoombOMaticPlatform(fakeLogger(), {
      platform: PLATFORM_NAME,
      devices: [device],
    }, api, {
      robotFactory: () => ({
        start: async () => undefined,
        stop: async () => undefined,
        dock: async () => undefined,
        getRobotState: async () => ({ batPct: 90, bin: {}, cleanMissionStatus: { phase: 'charge' } }),
        end: () => undefined,
      }),
    })
    await platform.discoverDevices()
    await vi.waitFor(() => {
      expect(matterRegistered.length).toBe(1)
    })
    const matter = matterRegistered[0] as { clusters: { rvcCleanMode: { supportedModes: unknown[] } }, serialNumber: string, context: unknown }
    expect(matter.clusters.rvcCleanMode.supportedModes.length).toBeGreaterThanOrEqual(2)
    expect(matter.clusters.rvcCleanMode.supportedModes.length).toBeLessThanOrEqual(255)
    expect(JSON.stringify(matter)).not.toContain('LOCALBLID')
    expect(JSON.stringify(matter)).not.toContain('LOCALPWD')
    expect(registered).toHaveLength(1)
    platform.shutdown()
  })
})
