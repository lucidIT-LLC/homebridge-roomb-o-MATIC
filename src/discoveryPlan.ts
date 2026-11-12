import type { CloudDiscoveryResult } from './cloudDiscovery.js'
import type { DeviceConfig, RoombOMaticConfig } from './settings.js'

import { cleanCredential } from './redact.js'

export interface DiscoveryPlan {
  source: 'local' | 'cloud' | 'none'
  devices: DeviceConfig[]
  retry: boolean
  /**
   * Always empty. A failed or empty cloud discovery must not unregister
   * accessories Homebridge already cached.
   */
  unregisterUuids: string[]
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

function localDevices(config: RoombOMaticConfig): DeviceConfig[] {
  if (!Array.isArray(config.devices)) {
    return []
  }
  return config.devices.filter(usableLocalDevice).map(device => sanitizeDevice(device))
}

/**
 * Manual devices[] never contact Gigya. Cloud discovery is only used when no
 * local devices are configured. Failure and empty results keep cached
 * accessories and ask the caller to retry.
 */
export async function planDeviceDiscovery(input: {
  config: RoombOMaticConfig
  discoverCloud: (email: string, password: string) => Promise<CloudDiscoveryResult>
}): Promise<DiscoveryPlan> {
  const emptyUnregister: string[] = []
  const configured = Array.isArray(input.config.devices) ? input.config.devices : undefined
  if (configured && configured.length > 0) {
    return {
      source: 'local',
      devices: localDevices(input.config),
      retry: false,
      unregisterUuids: emptyUnregister,
    }
  }
  if (input.config.disableDiscovery === true || !input.config.email || !input.config.password) {
    return {
      source: 'none',
      devices: [],
      retry: false,
      unregisterUuids: emptyUnregister,
    }
  }
  let result: CloudDiscoveryResult
  try {
    result = await input.discoverCloud(input.config.email, input.config.password)
  }
  catch {
    result = { ok: false, robots: [] }
  }
  const robots = (result.robots ?? []).filter(usableLocalDevice).map(device => sanitizeDevice(device))
  if (!result.ok || robots.length === 0) {
    return {
      source: 'cloud',
      devices: [],
      retry: true,
      unregisterUuids: emptyUnregister,
    }
  }
  return {
    source: 'cloud',
    devices: robots,
    retry: false,
    unregisterUuids: emptyUnregister,
  }
}
