import type { Logging } from 'homebridge'

import type { DeviceConfig } from './settings.js'

import { redactValue } from './redact.js'

/**
 * Normalize the configured robot list. v1.2.1 accepted either an array or a
 * map of devices and did not contact the iRobot cloud.
 */
export async function getRoombas(
  robots: DeviceConfig[] | Record<string, DeviceConfig> | undefined,
  log: Logging,
): Promise<DeviceConfig[]> {
  if (!robots) {
    return []
  }
  const all = Array.isArray(robots) ? robots : Object.values(robots)
  log.debug('Processed robots:', JSON.stringify(redactValue(all)))
  return all
}
