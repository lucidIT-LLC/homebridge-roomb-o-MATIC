import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

describe('config schema', () => {
  it('is real JSON for the v1.2.1 device shape plus rooms and Matter', () => {
    const raw = readFileSync('config.schema.json', 'utf8')
    expect(raw).not.toContain('import {')
    const schema = JSON.parse(raw) as {
      pluginAlias: string
      pluginType: string
      schema: { properties: Record<string, { items?: { properties?: Record<string, unknown> } }> }
    }
    expect(schema.pluginAlias).toBe('Roomb-O-Matic')
    expect(schema.pluginType).toBe('platform')
    const devices = schema.schema.properties.devices?.items?.properties ?? {}
    expect(devices).toHaveProperty('name')
    expect(devices).toHaveProperty('blid')
    expect(devices).toHaveProperty('robotpwd')
    expect(devices).toHaveProperty('ipaddress')
    expect(devices).toHaveProperty('pmapId')
    expect(devices).toHaveProperty('userPmapvId')
    expect(devices).toHaveProperty('rooms')
    expect(schema.schema.properties).toHaveProperty('disableDiscovery')
    expect(schema.schema.properties).toHaveProperty('enableMatter')
  })
})
