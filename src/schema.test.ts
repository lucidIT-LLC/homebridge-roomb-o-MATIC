import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

interface SchemaNode {
  required?: unknown
  properties?: Record<string, SchemaNode>
  items?: SchemaNode
}

function assertRequiredIsArray(node: SchemaNode, path: string): void {
  if (Object.prototype.hasOwnProperty.call(node, 'required')) {
    expect(node.required, `${path}.required`).toEqual(expect.any(Array))
  }
  for (const [key, child] of Object.entries(node.properties ?? {})) {
    assertRequiredIsArray(child, `${path}.properties.${key}`)
  }
  if (node.items) {
    assertRequiredIsArray(node.items, `${path}.items`)
  }
}

describe('config schema', () => {
  it('is real JSON for the v1.2.1 device shape plus rooms and Matter', () => {
    const raw = readFileSync('config.schema.json', 'utf8')
    expect(raw).not.toContain('import {')
    expect(raw).not.toMatch(/"required"\s*:\s*(true|false)/)
    const schema = JSON.parse(raw) as {
      pluginAlias: string
      pluginType: string
      schema: SchemaNode & {
        properties: Record<string, SchemaNode & { items?: SchemaNode & { properties?: Record<string, SchemaNode> } }>
      }
    }
    expect(schema.pluginAlias).toBe('Roomb-O-Matic')
    expect(schema.pluginType).toBe('platform')
    expect(schema.schema.required).toEqual(['name'])
    const devices = schema.schema.properties.devices?.items
    expect(devices?.required).toEqual(['name', 'blid', 'robotpwd', 'ipaddress'])
    const deviceProperties = devices?.properties ?? {}
    expect(deviceProperties).toHaveProperty('name')
    expect(deviceProperties).toHaveProperty('blid')
    expect(deviceProperties).toHaveProperty('robotpwd')
    expect(deviceProperties).toHaveProperty('ipaddress')
    expect(deviceProperties).toHaveProperty('pmapId')
    expect(deviceProperties).toHaveProperty('userPmapvId')
    expect(deviceProperties).toHaveProperty('rooms')
    expect(deviceProperties.rooms?.items?.required).toEqual(['id', 'name'])
    expect(schema.schema.properties).toHaveProperty('disableDiscovery')
    expect(schema.schema.properties).toHaveProperty('enableMatter')
    assertRequiredIsArray(schema.schema, 'schema')
  })
})
