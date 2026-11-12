import { readFileSync } from 'node:fs'

import { describe, expect, it, vi } from 'vitest'

import { CaptureRegistry } from './captureSession.js'
import {
  captureLocalPassword,
  decodePasswordPayload,
  parseRobotAnnouncement,
  PASSWORD_PACKET,
  robotTlsOptions,
  stripSecret,
  type PasswordSocket,
} from './passwordCapture.js'

function scriptedConnect(chunks: Buffer[]): () => PasswordSocket & { written: Buffer[] } {
  return () => {
    const listeners: Record<string, (...args: any[]) => void> = {}
    const socket = {
      written: [] as Buffer[],
      write(data: Buffer) {
        socket.written.push(data)
      },
      end() {},
      on(event: 'secureConnect' | 'data' | 'error', listener: (...args: any[]) => void) {
        listeners[event] = listener
      },
    }
    queueMicrotask(() => {
      listeners.secureConnect?.()
      for (const chunk of chunks) {
        listeners.data?.(chunk)
      }
    })
    return socket
  }
}

describe('local password capture', () => {
  it('accepts the robot certificate unless verification is turned on', () => {
    const previous = process.env.ROOMBA_TLS_VERIFY
    delete process.env.ROOMBA_TLS_VERIFY
    expect(robotTlsOptions().rejectUnauthorized).toBe(false)
    process.env.ROOMBA_TLS_VERIFY = '1'
    expect(robotTlsOptions().rejectUnauthorized).toBe(true)
    if (previous === undefined) {
      delete process.env.ROOMBA_TLS_VERIFY
    }
    else {
      process.env.ROOMBA_TLS_VERIFY = previous
    }
  })

  it('strips trailing NUL bytes and whitespace', () => {
    expect(stripSecret('secret\u0000\u0000')).toBe('secret')
    expect(stripSecret('secret\u0000 \n')).toBe('secret')
    const payload = Buffer.concat([Buffer.alloc(13, 1), Buffer.from('secret\0\0')])
    expect(decodePasswordPayload(payload, 13)).toBe('secret')
    expect(decodePasswordPayload(payload, 13)).not.toBe(stripSecret(payload.subarray(7).toString('utf8')))
  })

  it('slices a 38-byte :1: packet from offset 7, not the truncated offset 13', async () => {
    const password = ':1:example-local-secret-pad000'
    expect(password).toHaveLength(30)
    expect(password.startsWith(':1:')).toBe(true)
    const packet = Buffer.concat([
      Buffer.from([0x10, 0x21, 0x32, 0x43, 0x54, 0x65, 0x76]),
      Buffer.from(password, 'utf8'),
      Buffer.from([0x00]),
    ])
    expect(packet).toHaveLength(38)

    const at7 = stripSecret(packet.subarray(7).toString('utf8'))
    const at9 = stripSecret(packet.subarray(9).toString('utf8'))
    const at13 = stripSecret(packet.subarray(13).toString('utf8'))
    expect(at7).toBe(password)
    expect(at9).not.toBe(password)
    expect(at13).toHaveLength(24)
    expect(at13.startsWith(':1:')).toBe(false)

    expect(decodePasswordPayload(packet, 13)).toBe(at7)
    expect(decodePasswordPayload(packet, 9)).toBe(at7)
    expect(decodePasswordPayload(packet, 7)).toBe(at7)
    expect(decodePasswordPayload(packet, 13)).not.toBe(at13)
    expect(decodePasswordPayload(packet, 9)).not.toBe(at9)

    const captured = await captureLocalPassword({
      ip: '192.0.2.10',
      connect: scriptedConnect([packet]),
      maxAttempts: 1,
      retryDelayMs: 0,
      sleep: async () => undefined,
    })
    expect(captured).toBe(password)
    expect(captured).toHaveLength(30)
    expect(captured.startsWith(':1:')).toBe(true)
    expect(captured).not.toBe(at13)

    const afterShortChunk = await captureLocalPassword({
      ip: '192.0.2.10',
      connect: scriptedConnect([Buffer.from([0x00, 0x02]), packet]),
      maxAttempts: 1,
      retryDelayMs: 0,
      sleep: async () => undefined,
    })
    expect(afterShortChunk).toBe(password)
    expect(afterShortChunk).not.toBe(at9)
    expect(afterShortChunk).not.toBe(at13)
  })

  it('slices from a :1: prefix that is not at offset 7', () => {
    const password = ':1:other-layout-secret'
    const packet = Buffer.concat([
      Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x0e, 0x0f]),
      Buffer.from(`${password}\0`, 'utf8'),
    ])
    expect(packet.indexOf(':1:')).toBe(10)
    expect(decodePasswordPayload(packet, 13)).toBe(password)
    expect(decodePasswordPayload(packet, 9)).toBe(password)
    expect(decodePasswordPayload(packet, 13)).not.toBe(stripSecret(packet.subarray(7).toString('utf8')))
    expect(decodePasswordPayload(packet, 13)).not.toBe(stripSecret(packet.subarray(13).toString('utf8')))
  })

  it('captures a password without setRawMode and writes the dorita980 probe', async () => {
    const stdin = process.stdin as NodeJS.ReadStream & { setRawMode?: (enabled: boolean) => void }
    const original = stdin.setRawMode
    stdin.setRawMode = () => {
      throw new Error('setRawMode is not a function')
    }
    let written: Buffer[] = []
    const connect = () => {
      const socket = scriptedConnect([
        Buffer.from([0x00, 0x01]),
        Buffer.concat([Buffer.alloc(9, 2), Buffer.from('local-password\0')]),
      ])()
      written = socket.written
      return socket
    }
    try {
      const password = await captureLocalPassword({
        ip: '192.0.2.10',
        connect,
        maxAttempts: 1,
        retryDelayMs: 0,
        sleep: async () => undefined,
      })
      expect(password).toBe('local-password')
      expect(written[0]).toEqual(PASSWORD_PACKET)
    }
    finally {
      if (original) {
        stdin.setRawMode = original
      }
      else {
        delete stdin.setRawMode
      }
    }
  })

  it('does not call setRawMode from the capture, CLI, or config UI sources', () => {
    const files = [
      'src/passwordCapture.ts',
      'src/cli/get-password.ts',
      'src/captureSession.ts',
      'homebridge-ui/server.js',
      'homebridge-ui/public/index.html',
    ]
    for (const file of files) {
      expect(readFileSync(file, 'utf8')).not.toContain('setRawMode')
    }
  })

  it('keeps a leading :1: and the CLI uses the shared decoder', () => {
    const password = ':1:example-local-secret-pad000'
    expect(stripSecret(`${password}\0\0`)).toBe(password)
    expect(stripSecret(`  ${password}\n`)).toBe(password)
    const cli = readFileSync('src/cli/get-password.ts', 'utf8')
    expect(cli).toContain('captureLocalPassword')
    expect(cli).not.toMatch(/sliceFrom|subarray\(\s*13\s*\)|slice\(\s*13\s*\)/)
  })

  it('parses a robot announcement without requiring the password helper', () => {
    const message = Buffer.from(JSON.stringify({ hostname: 'iRobot-ABC123', ip: '192.0.2.10' }))
    expect(parseRobotAnnouncement(message)).toEqual({ blid: 'ABC123', ip: '192.0.2.10' })
  })

  it('returns a stripped password from the UI capture session', async () => {
    const registry = new CaptureRegistry({
      capture: vi.fn(async () => 'session-secret\0\0'),
      lookup: vi.fn(async () => undefined),
    })
    const { jobId } = registry.start({ ip: '192.0.2.10', blid: 'BLID123', name: 'Roomba' })
    expect(registry.poll(jobId).robotpwd).toBeUndefined()
    const done = await vi.waitFor(() => {
      const polled = registry.poll(jobId)
      expect(polled.state).not.toBe('pending')
      return polled
    })
    expect(done).toMatchObject({ state: 'done', robotpwd: 'session-secret', blid: 'BLID123' })
    expect(registry.poll(jobId).state).toBe('error')
  })
})
