import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { runGetPassword } from './cli/get-password.js'

describe('get-password CLI', () => {
  it('writes stripped credentials and does not print them', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'roomb-o-matic-'))
    const configPath = join(directory, 'config.json')
    writeFileSync(configPath, JSON.stringify({ bridge: { name: 'Home' }, platforms: [] }))
    const logs: string[] = []
    const code = await runGetPassword([
      '--ip',
      '192.0.2.10',
      '--config',
      configPath,
      '--name',
      'Kitchen',
      '--blid',
      'BLIDVALUE',
    ], {
      capture: async () => 'captured-password\0\0',
      lookup: async () => {
        throw new Error('lookup should not run when blid is provided')
      },
      log: message => logs.push(message),
      error: message => logs.push(message),
    })
    expect(code).toBe(0)
    const saved = JSON.parse(readFileSync(configPath, 'utf8')) as {
      platforms: Array<{ disableDiscovery?: boolean, devices: Array<{ robotpwd: string, blid: string }> }>
    }
    expect(saved.platforms[0]?.disableDiscovery).toBe(true)
    expect(saved.platforms[0]?.devices[0]).toMatchObject({
      name: 'Kitchen',
      blid: 'BLIDVALUE',
      robotpwd: 'captured-password',
      ipaddress: '192.0.2.10',
    })
    const printed = logs.join('\n')
    expect(printed).not.toContain('captured-password')
    expect(printed).not.toContain('BLIDVALUE')
    expect(printed).toContain('Home')
  })
})
