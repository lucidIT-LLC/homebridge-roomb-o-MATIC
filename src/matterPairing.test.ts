import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { loadMatterPairing, pairingEntriesFromCommissioning, writeMatterDeviceIndex } from './matterPairing.js'

describe('Matter pairing codes', () => {
  it('labels a Roomba code separately from the Homebridge bridge code', async () => {
    const entries = await pairingEntriesFromCommissioning([
      {
        serialNumber: 'bridge-1',
        manualPairingCode: '1111-222-3333',
        qrCode: 'MT:BRIDGE',
        commissioned: true,
      },
      {
        serialNumber: 'roomba-abc',
        manualPairingCode: '3497-011-2334',
        qrCode: 'MT:ROOMBA',
        commissioned: false,
      },
    ], [{ name: 'Kitchen', serialNumber: 'roomba-abc', uuid: 'uuid-1' }])
    expect(entries[0]).toMatchObject({
      kind: 'vacuum',
      name: 'Kitchen',
      manualPairingCode: '3497-011-2334',
      commissioned: false,
    })
    expect(entries[0]?.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/)
    expect(entries[1]).toMatchObject({ kind: 'bridge', name: 'Homebridge Matter bridge' })
    expect(entries[1]?.qrCode).toBeUndefined()
    expect(entries[0]?.hint).toContain('not the Homebridge bridge code')
  })

  it('reads commissioning files from the Homebridge matter directory', async () => {
    const storage = mkdtempSync(join(tmpdir(), 'roomb-o-matic-matter-'))
    writeMatterDeviceIndex(storage, [{ name: 'Hall', serialNumber: 'roomba-hall', uuid: 'uuid-hall' }])
    const node = join(storage, 'matter', 'AABBCCDDEEFF')
    mkdirSync(node, { recursive: true })
    writeFileSync(join(node, 'commissioning.json'), JSON.stringify({
      serialNumber: 'roomba-hall',
      manualPairingCode: '1234-567-8901',
      qrCode: 'MT:HALL',
      commissioned: false,
      passcode: 12345678,
    }))
    const result = await loadMatterPairing(storage)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.entries).toHaveLength(1)
      expect(result.entries[0]).toMatchObject({ name: 'Hall', manualPairingCode: '1234-567-8901' })
      expect(JSON.stringify(result.entries)).not.toContain('12345678')
    }
  })
})
