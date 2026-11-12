import type { PlatformConfig } from 'homebridge'

/**
 * Platform name stored in config.json. Existing Roomb-O-Matic installs use this
 * exact string. Do not rename it.
 */
export const PLATFORM_NAME = 'Roomb-O-Matic'

export const PLUGIN_NAME = 'homebridge-roomb-o-matic'

export type CleanMode = 'automatic' | 'deep' | 'quick'

export type MatterPreference = boolean | 'auto' | 'on' | 'off'

export interface RoomConfig {
  id: string
  name: string
  selected?: boolean
}

export interface DeviceConfig {
  name: string
  blid: string
  robotpwd: string
  ipaddress: string
  pmapId?: string
  userPmapvId?: string
  cleanMode?: CleanMode
  rooms?: RoomConfig[]
  model?: string
  softwareVer?: string
}

export interface RoombOMaticConfig extends PlatformConfig {
  disableDiscovery?: boolean
  enableMatter?: MatterPreference
  email?: string
  password?: string
  devices?: DeviceConfig[]
}

export function matterPreferenceEnabled(preference: MatterPreference | undefined, matterAvailable: boolean): boolean {
  if (preference === false || preference === 'off') {
    return false
  }
  return matterAvailable
}
