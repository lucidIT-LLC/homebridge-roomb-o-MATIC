import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import QRCode from 'qrcode'

export const MATTER_INDEX_FILE = 'roomb-o-matic-matter.json'

export interface MatterDeviceIndexEntry {
  name: string
  serialNumber: string
  uuid: string
}

export interface MatterPairingEntry {
  name: string
  serialNumber: string
  manualPairingCode: string
  qrCode?: string
  qrCodeDataUrl?: string
  commissioned: boolean
  kind: 'vacuum' | 'bridge'
  hint: string
}

interface CommissioningFile {
  qrCode?: unknown
  manualPairingCode?: unknown
  serialNumber?: unknown
  commissioned?: unknown
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function writeMatterDeviceIndex(storagePath: string, devices: MatterDeviceIndexEntry[]): void {
  const next = devices
    .filter(device => device.name && device.serialNumber && device.uuid)
    .map(device => ({
      name: device.name,
      serialNumber: device.serialNumber,
      uuid: device.uuid,
    }))
  writeFileSync(join(storagePath, MATTER_INDEX_FILE), `${JSON.stringify({ devices: next }, null, 2)}\n`, 'utf8')
}

export function readMatterDeviceIndex(storagePath: string): MatterDeviceIndexEntry[] {
  const file = join(storagePath, MATTER_INDEX_FILE)
  if (!existsSync(file)) {
    return []
  }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { devices?: MatterDeviceIndexEntry[] }
    return Array.isArray(parsed.devices) ? parsed.devices : []
  }
  catch {
    return []
  }
}

export function listCommissioningFiles(storagePath: string): string[] {
  const matterPath = join(storagePath, 'matter')
  if (!existsSync(matterPath)) {
    return []
  }
  const files: string[] = []
  for (const entry of readdirSync(matterPath, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.includes('.')) {
      continue
    }
    const file = join(matterPath, entry.name, 'commissioning.json')
    if (existsSync(file)) {
      files.push(file)
    }
  }
  return files
}

export async function pairingEntriesFromCommissioning(
  files: Array<{ serialNumber?: string, manualPairingCode?: string, qrCode?: string, commissioned?: boolean }>,
  devices: MatterDeviceIndexEntry[],
): Promise<MatterPairingEntry[]> {
  const bySerial = new Map(devices.map(device => [device.serialNumber, device]))
  const entries: MatterPairingEntry[] = []
  for (const file of files) {
    const manualPairingCode = file.manualPairingCode?.trim()
    if (!manualPairingCode) {
      continue
    }
    const serialNumber = file.serialNumber?.trim() ?? ''
    const matched = serialNumber ? bySerial.get(serialNumber) : undefined
    const kind: MatterPairingEntry['kind'] = matched || serialNumber.startsWith('roomba-') ? 'vacuum' : 'bridge'
    const qrCode = file.qrCode?.trim()
    let qrCodeDataUrl: string | undefined
    if (qrCode && kind === 'vacuum') {
      qrCodeDataUrl = await QRCode.toDataURL(qrCode, { errorCorrectionLevel: 'M', margin: 1, width: 220 })
    }
    entries.push({
      name: matched?.name || (kind === 'vacuum' ? 'Roomba' : 'Homebridge Matter bridge'),
      serialNumber,
      manualPairingCode,
      qrCode: kind === 'vacuum' ? qrCode : undefined,
      qrCodeDataUrl,
      commissioned: Boolean(file.commissioned),
      kind,
      hint: kind === 'vacuum'
        ? 'Add this robot in the Apple Home app with this code. It is not the Homebridge bridge code.'
        : 'This code pairs the Homebridge bridge. The vacuum has its own code.',
    })
  }
  return entries.sort((left, right) => Number(left.kind === 'bridge') - Number(right.kind === 'bridge'))
}

export async function loadMatterPairing(storagePath: string): Promise<{ ok: true, entries: MatterPairingEntry[] } | { ok: false, message: string }> {
  try {
    const devices = readMatterDeviceIndex(storagePath)
    const files = listCommissioningFiles(storagePath).map((file) => {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as CommissioningFile
      return {
        serialNumber: text(parsed.serialNumber),
        manualPairingCode: text(parsed.manualPairingCode),
        qrCode: text(parsed.qrCode),
        commissioned: Boolean(parsed.commissioned),
      }
    })
    return {
      ok: true,
      entries: await pairingEntriesFromCommissioning(files, devices),
    }
  }
  catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Could not read Matter pairing files.',
    }
  }
}
