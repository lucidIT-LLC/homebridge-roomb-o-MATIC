import type { CloudDiscoveryResult } from './cloudDiscovery.js'
import type { DeviceConfig, RoombOMaticConfig } from './settings.js'

import { discoverLocalRobots } from './passwordCapture.js'
import { cleanCredential } from './redact.js'

export interface DiscoveryPlan {
  source: 'local' | 'cloud' | 'none'
  devices: DeviceConfig[]
  retry: boolean
  /**
   * True when this result is the user's current robot list. Cached accessories
   * that are not in `devices` should be removed. A failed or empty cloud
   * discovery leaves this false so already-cached accessories stay registered.
   */
  authoritative: boolean
}

export function backoffDelayMs(attempt: number, baseMs = 15_000, capMs = 300_000): number {
  const exponent = Math.max(0, Math.min(attempt, 8))
  return Math.min(baseMs * (2 ** exponent), capMs)
}

export function sanitizeDevice(device: DeviceConfig): DeviceConfig {
  return {
    ...device,
    name: device.name?.trim() ?? '',
    blid: cleanCredential(device.blid ?? ''),
    robotpwd: cleanCredential(device.robotpwd ?? ''),
    ipaddress: device.ipaddress?.trim() ?? '',
    pmapId: device.pmapId?.trim() || undefined,
    userPmapvId: device.userPmapvId?.trim() || undefined,
  }
}

export function usableLocalDevice(device: DeviceConfig | undefined): device is DeviceConfig {
  if (!device) {
    return false
  }
  const clean = sanitizeDevice(device)
  return Boolean(clean.name && clean.blid && clean.robotpwd && clean.ipaddress)
}

export function configuredDeviceList(config: RoombOMaticConfig): DeviceConfig[] | undefined {
  const devices = config.devices as DeviceConfig[] | Record<string, DeviceConfig> | undefined
  if (!devices) {
    return undefined
  }
  if (Array.isArray(devices)) {
    return devices
  }
  if (typeof devices === 'object') {
    return Object.values(devices)
  }
  return undefined
}

function ipHints(devices: DeviceConfig[] | undefined): Map<string, string> {
  const hints = new Map<string, string>()
  for (const device of devices ?? []) {
    const clean = sanitizeDevice(device)
    if (clean.blid && clean.ipaddress) {
      hints.set(clean.blid, clean.ipaddress)
    }
  }
  return hints
}

/**
 * Manual devices[] never contact Gigya. Cloud discovery is only used when no
 * local devices are configured. Failure and empty results keep cached
 * accessories and ask the caller to retry.
 */
export async function planDeviceDiscovery(input: {
  config: RoombOMaticConfig
  discoverCloud: (email: string, password: string) => Promise<CloudDiscoveryResult>
  locateRobots?: () => Promise<Array<{ blid: string, ip: string }>>
}): Promise<DiscoveryPlan> {
  const listed = configuredDeviceList(input.config)
  const complete = (listed ?? []).filter(usableLocalDevice).map(device => sanitizeDevice(device))
  const cloudAllowed = input.config.disableDiscovery !== true && Boolean(input.config.email && input.config.password)
  if (complete.length > 0 || (listed !== undefined && !cloudAllowed)) {
    return {
      source: 'local',
      devices: complete,
      retry: false,
      authoritative: true,
    }
  }
  if (!cloudAllowed) {
    return {
      source: 'none',
      devices: [],
      retry: false,
      authoritative: false,
    }
  }
  let result: CloudDiscoveryResult
  try {
    result = await input.discoverCloud(input.config.email!, input.config.password!)
  }
  catch {
    result = { ok: false, robots: [] }
  }
  if (!result.ok) {
    return {
      source: 'cloud',
      devices: [],
      retry: true,
      authoritative: false,
    }
  }
  const hints = ipHints(listed)
  let located: Array<{ blid: string, ip: string }> = []
  try {
    located = await (input.locateRobots ?? discoverLocalRobots)()
  }
  catch {
    located = []
  }
  const found = new Map(located.map(robot => [robot.blid, robot.ip]))
  const robots = (result.robots ?? []).map((robot) => {
    const clean = sanitizeDevice(robot)
    const ipaddress = clean.ipaddress || hints.get(clean.blid) || found.get(clean.blid) || ''
    return sanitizeDevice({ ...clean, ipaddress })
  }).filter(usableLocalDevice)
  if (robots.length === 0) {
    return {
      source: 'cloud',
      devices: [],
      retry: true,
      authoritative: false,
    }
  }
  return {
    source: 'cloud',
    devices: robots,
    retry: false,
    authoritative: true,
  }
}
