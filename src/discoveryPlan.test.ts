import { describe, expect, it, vi } from 'vitest'

import { backoffDelayMs, planDeviceDiscovery, sanitizeDevice } from './discoveryPlan.js'
import type { DeviceConfig } from './settings.js'

const local: DeviceConfig = {
  name: 'Roomba',
  blid: 'blid\0',
  robotpwd: 'secret\0\0',
  ipaddress: '192.0.2.10',
}

describe('discovery planning', () => {
  it('strips trailing NULs from stored credentials', () => {
    expect(sanitizeDevice(local)).toMatchObject({ blid: 'blid', robotpwd: 'secret' })
  })

  it('skips cloud login when local devices are configured', async () => {
    const discoverCloud = vi.fn(async () => ({ ok: true, robots: [] }))
    const plan = await planDeviceDiscovery({
      config: {
        platform: 'Roomb-O-Matic',
        email: 'person@example.com',
        password: 'account-secret',
        devices: [local],
      },
      discoverCloud,
    })
    expect(discoverCloud).not.toHaveBeenCalled()
    expect(plan.source).toBe('local')
    expect(plan.devices[0]?.robotpwd).toBe('secret')
    expect(plan.unregisterUuids).toEqual([])
    expect(plan.retry).toBe(false)
  })

  it('does not unregister cached accessories when cloud discovery fails or is empty', async () => {
    const failed = await planDeviceDiscovery({
      config: { platform: 'Roomb-O-Matic', email: 'person@example.com', password: 'account-secret' },
      discoverCloud: async () => {
        throw new Error('Gigya 403')
      },
    })
    expect(failed.retry).toBe(true)
    expect(failed.devices).toEqual([])
    expect(failed.unregisterUuids).toEqual([])

    const empty = await planDeviceDiscovery({
      config: { platform: 'Roomb-O-Matic', email: 'person@example.com', password: 'account-secret' },
      discoverCloud: async () => ({
        ok: true,
        robots: [{ name: 'Cloud', blid: 'abc', robotpwd: 'pwd', ipaddress: '' }],
      }),
    })
    expect(empty.retry).toBe(true)
    expect(empty.unregisterUuids).toEqual([])
  })

  it('backs off and then caps the cloud retry delay', () => {
    expect(backoffDelayMs(0)).toBe(15_000)
    expect(backoffDelayMs(1)).toBe(30_000)
    expect(backoffDelayMs(2)).toBe(60_000)
    expect(backoffDelayMs(20)).toBe(300_000)
  })
})
