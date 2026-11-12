import { constants } from 'node:crypto'
import { createSocket, type Socket as DgramSocket } from 'node:dgram'
import tls from 'node:tls'

import { cleanCredential } from './redact.js'

export const PASSWORD_PACKET = Buffer.from('f005efcc3b2900', 'hex')
export const PASSWORD_PORT = 8883

export function stripSecret(value: string): string {
  return cleanCredential(value)
}

/**
 * Decode one password-capture TLS record the way dorita980 does, then drop
 * trailing NUL bytes. A trailing NUL makes MQTT reject the password.
 */
export function decodePasswordPayload(data: Buffer, sliceFrom = 13): string | undefined {
  if (data.length <= 7) {
    return undefined
  }
  const start = Math.min(sliceFrom, data.length)
  const cleaned = stripSecret(data.subarray(start).toString('utf8'))
  return cleaned.length > 0 ? cleaned : undefined
}

export function parseRobotAnnouncement(message: Buffer): { blid: string, ip?: string } | undefined {
  try {
    const parsed = JSON.parse(message.toString('utf8')) as { hostname?: unknown, ip?: unknown }
    if (typeof parsed.hostname !== 'string') {
      return undefined
    }
    const separator = parsed.hostname.indexOf('-')
    if (separator <= 0) {
      return undefined
    }
    const kind = parsed.hostname.slice(0, separator)
    const blid = parsed.hostname.slice(separator + 1)
    if ((kind !== 'Roomba' && kind !== 'iRobot') || blid.length === 0) {
      return undefined
    }
    return {
      blid,
      ip: typeof parsed.ip === 'string' ? parsed.ip : undefined,
    }
  }
  catch {
    return undefined
  }
}

export interface PasswordSocket {
  write: (data: Buffer) => void
  end: () => void
  on: (event: 'secureConnect' | 'data' | 'error', listener: (...args: any[]) => void) => void
}

export interface CaptureLocalPasswordOptions {
  ip: string
  connect?: (port: number, host: string, options: tls.ConnectionOptions) => PasswordSocket
  maxAttempts?: number
  retryDelayMs?: number
  attemptTimeoutMs?: number
  sleep?: (ms: number) => Promise<void>
  onStatus?: (message: string) => void
}

const WAITING = 'Close the iRobot app. Press and hold the Home button for about 2 seconds, until the robot plays a series of tones.'

function tlsOptions(): tls.ConnectionOptions {
  const options: tls.ConnectionOptions = {
    // codeql[js/disabling-certificate-validation]
    // The robot presents a self-signed certificate. This socket is opened only to the configured robot IP.
    rejectUnauthorized: false,
    ciphers: process.env.ROBOT_CIPHERS || 'AES128-SHA256,TLS_AES_256_GCM_SHA384',
  }
  if (process.env.ROBOT_TLS_LEGACY !== '0' && constants.SSL_OP_LEGACY_SERVER_CONNECT) {
    options.secureOptions = constants.SSL_OP_LEGACY_SERVER_CONNECT
  }
  return options
}

function defaultConnect(port: number, host: string, options: tls.ConnectionOptions): PasswordSocket {
  return tls.connect(port, host, options)
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}

function attemptOnce(ip: string, connect: CaptureLocalPasswordOptions['connect'], timeoutMs: number): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    let settled = false
    let sliceFrom = 13
    let wrote = false
    const socket = (connect ?? defaultConnect)(PASSWORD_PORT, ip, tlsOptions())
    const finish = (callback: () => void) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      try {
        socket.end()
      }
      catch {
        // The socket may already be closed.
      }
      callback()
    }
    const timer = setTimeout(() => finish(() => resolve(undefined)), timeoutMs)
    const sendProbe = () => {
      if (wrote || settled) {
        return
      }
      wrote = true
      socket.write(PASSWORD_PACKET)
    }
    socket.on('secureConnect', sendProbe)
    socket.on('data', (chunk: Buffer | string) => {
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      if (data.length === 2) {
        sliceFrom = 9
        return
      }
      if (data.length <= 7) {
        finish(() => resolve(undefined))
        return
      }
      finish(() => resolve(decodePasswordPayload(data, sliceFrom)))
    })
    socket.on('error', (error: unknown) => {
      finish(() => reject(error instanceof Error ? error : new Error(String(error))))
    })
  })
}

/**
 * Capture a local robot password without a TTY. The dorita980 helper waits for
 * a keypress on a raw terminal, which throws under docker exec.
 */
export async function captureLocalPassword(options: CaptureLocalPasswordOptions): Promise<string> {
  const maxAttempts = options.maxAttempts ?? 30
  const retryDelayMs = options.retryDelayMs ?? 2_000
  const attemptTimeoutMs = options.attemptTimeoutMs ?? 8_000
  const sleep = options.sleep ?? delay
  let lastDetail = WAITING
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    options.onStatus?.(`${WAITING} Attempt ${attempt} of ${maxAttempts}.`)
    try {
      const password = await attemptOnce(options.ip, options.connect, attemptTimeoutMs)
      if (password) {
        return password
      }
      lastDetail = WAITING
    }
    catch (error) {
      lastDetail = error instanceof Error ? error.message : String(error)
    }
    if (attempt < maxAttempts) {
      await sleep(retryDelayMs)
    }
  }
  throw new Error(`Password capture failed after ${maxAttempts} attempts. ${lastDetail}`)
}

interface LookupSocket {
  on: (event: 'message' | 'error', listener: (...args: any[]) => void) => void
  bind: (port: number, callback?: () => void) => void
  send: (message: Buffer, offset: number, length: number, port: number, address: string) => void
  close: () => void
}

export async function lookupBlid(ip: string, options?: {
  timeoutMs?: number
  createSocket?: () => LookupSocket
}): Promise<string | undefined> {
  const timeoutMs = options?.timeoutMs ?? 3_000
  const factory = options?.createSocket ?? (() => createSocket('udp4') as DgramSocket)
  return await new Promise((resolve) => {
    let settled = false
    const socket = factory()
    const finish = (blid?: string) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      try {
        socket.close()
      }
      catch {
        // Already closed.
      }
      resolve(blid)
    }
    const timer = setTimeout(() => finish(undefined), timeoutMs)
    socket.on('error', () => finish(undefined))
    socket.on('message', (message: Buffer) => {
      const parsed = parseRobotAnnouncement(message)
      if (parsed?.blid) {
        finish(stripSecret(parsed.blid))
      }
    })
    try {
      socket.bind(0, () => {
        const message = Buffer.from('irobotmcs')
        socket.send(message, 0, message.length, 5678, ip)
      })
    }
    catch {
      finish(undefined)
    }
  })
}
