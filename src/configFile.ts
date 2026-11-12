import { readFileSync, writeFileSync } from 'node:fs'

import type { DeviceConfig, RoombOMaticConfig } from './settings.js'
import { PLATFORM_NAME } from './settings.js'

import { sanitizeDevice } from './discoveryPlan.js'

export interface HomebridgeConfigFile {
  platforms?: RoombOMaticConfig[]
  [key: string]: unknown
}

export function upsertLocalDevice(config: RoombOMaticConfig, device: DeviceConfig): RoombOMaticConfig {
  const incoming = sanitizeDevice(device)
  const devices = [...(config.devices ?? [])]
  const index = devices.findIndex(existing =>
    (incoming.blid && existing.blid === incoming.blid)
    || (incoming.ipaddress && existing.ipaddress === incoming.ipaddress),
  )
  if (index >= 0) {
    devices[index] = sanitizeDevice({ ...devices[index], ...incoming })
  }
  else {
    devices.push(incoming)
  }
  return {
    ...config,
    platform: PLATFORM_NAME,
    name: config.name || PLATFORM_NAME,
    disableDiscovery: true,
    devices,
  }
}

export function writeDeviceIntoHomebridgeConfig(config: HomebridgeConfigFile, device: DeviceConfig): HomebridgeConfigFile {
  const platforms = [...(config.platforms ?? [])]
  let index = platforms.findIndex(platform => platform?.platform === PLATFORM_NAME)
  if (index < 0) {
    platforms.push({
      platform: PLATFORM_NAME,
      name: PLATFORM_NAME,
      disableDiscovery: true,
      devices: [],
    })
    index = platforms.length - 1
  }
  platforms[index] = upsertLocalDevice(platforms[index] ?? { platform: PLATFORM_NAME }, device)
  return {
    ...config,
    platforms,
  }
}

export function readHomebridgeConfig(path: string): HomebridgeConfigFile {
  const raw = readFileSync(path, 'utf8')
  const parsed = JSON.parse(raw) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Config file ${path} is not a JSON object.`)
  }
  return parsed as HomebridgeConfigFile
}

export function writeHomebridgeConfig(path: string, config: HomebridgeConfigFile): void {
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
}
