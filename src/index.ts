import type { API } from 'homebridge'

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { RoombOMaticPlatform } from './platform.js'
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js'

function pluginVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    const raw = readFileSync(join(here, '..', 'package.json'), 'utf8')
    const parsed = JSON.parse(raw) as { version?: string }
    return parsed.version ?? 'unknown'
  }
  catch {
    return 'unknown'
  }
}

export default function (api: API): void {
  console.log(`[${PLUGIN_NAME}] Loaded — Version ${pluginVersion()}`)
  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, RoombOMaticPlatform)
}
