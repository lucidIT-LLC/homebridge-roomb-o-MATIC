import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

const pluginRoot = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const homebridgeBin = join(pluginRoot, 'node_modules', 'homebridge', 'bin', 'homebridge.js')

function stop(child: ChildProcess | undefined): void {
  if (!child || child.killed) {
    return
  }
  child.kill('SIGTERM')
}

describe('Homebridge Matter commissioning', () => {
  let child: ChildProcess | undefined

  afterEach(() => {
    stop(child)
  })

  it('publishes a robotic vacuum with its own pairing code', async () => {
    expect(existsSync(join(pluginRoot, 'dist', 'index.js'))).toBe(true)
    const storage = mkdtempSync(join(tmpdir(), 'roomb-o-matic-hb-'))
    mkdirSync(storage, { recursive: true })
    writeFileSync(join(storage, 'config.json'), JSON.stringify({
      bridge: {
        name: 'Roomb-O-Matic Check',
        username: 'CC:22:3D:E3:CE:30',
        port: 51826,
        pin: '031-45-154',
        matter: { port: 5581 },
      },
      matterPorts: { start: 5600, end: 5610 },
      platforms: [{
        platform: 'Roomb-O-Matic',
        name: 'Roomb-O-Matic',
        disableDiscovery: true,
        enableMatter: 'on',
        devices: [{
          name: 'Test Roomba',
          blid: 'TESTBLID',
          robotpwd: 'test-password',
          ipaddress: '192.0.2.10',
          cleanMode: 'automatic',
          pmapId: 'pmap-test',
          userPmapvId: 'ver-test',
          rooms: [{ id: '1', name: 'Kitchen', selected: true }],
        }],
      }],
    }, null, 2))

    const log: string[] = []
    child = spawn(process.execPath, [
      homebridgeBin,
      '-U',
      storage,
      '-P',
      pluginRoot,
      '--strict-plugin-resolution',
      '-I',
    ], { cwd: pluginRoot, env: { ...process.env, HOMEBRIDGE_INSECURE: '1' } })
    child.stdout?.on('data', (chunk: Buffer) => log.push(chunk.toString()))
    child.stderr?.on('data', (chunk: Buffer) => log.push(chunk.toString()))

    const published = await waitFor(() => {
      const text = log.join('')
      if (/Matter publish failed|Behaviors have errors|Failed to publish external/i.test(text)) {
        throw new Error(text.slice(-4000))
      }
      if (!text.includes('Registered Matter accessory: Test Roomba')) {
        return undefined
      }
      return findCommissioning(storage)
    }, 45_000)

    expect(published.manualPairingCode).toMatch(/^\d{4}-\d{3}-\d{4}$/)
    expect(published.qrCode).toMatch(/^MT:/)
    expect(published.serialNumber).toMatch(/^roomba-/)
    expect(log.join('')).toMatch(/Registered Matter accessory: Test Roomba|Published Matter vacuum/)
    expect(log.join('')).not.toContain('test-password')
    expect(log.join('')).not.toContain('TESTBLID')
  }, 60_000)
})

function findCommissioning(storage: string): { manualPairingCode?: string, qrCode?: string, serialNumber?: string } | undefined {
  const matter = join(storage, 'matter')
  if (!existsSync(matter)) {
    return undefined
  }
  for (const entry of readdirSync(matter, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue
    }
    const file = join(matter, entry.name, 'commissioning.json')
    if (!existsSync(file)) {
      continue
    }
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { manualPairingCode?: string, qrCode?: string, serialNumber?: string }
    if (typeof parsed.serialNumber === 'string' && parsed.serialNumber.startsWith('roomba-')) {
      return parsed
    }
  }
  return undefined
}

async function waitFor<T>(read: () => T | undefined, timeoutMs: number): Promise<T> {
  const started = Date.now()
  let lastError: unknown
  while (Date.now() - started < timeoutMs) {
    try {
      const value = read()
      if (value) {
        return value
      }
    }
    catch (error) {
      lastError = error
      if (error instanceof Error && error.message.includes('Matter publish failed')) {
        throw error
      }
    }
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  const detail = lastError instanceof Error ? lastError.message : 'Timed out waiting for a Matter pairing code.'
  throw new Error(detail)
}
