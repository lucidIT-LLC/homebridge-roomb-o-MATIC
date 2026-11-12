import { constants } from 'node:crypto'
import { createSocket, type Socket as DgramSocket } from 'node:dgram'
import tls from 'node:tls'

import { cleanCredential } from './redact.js'

export const PASSWORD_PACKET = Buffer.from('f005efcc3b2900', 'hex')
export const PASSWORD_PORT = 8883

export function stripSecret(value: string): string {
  return cleanCredential(value)
}

const PASSWORD_PREFIX = ':1:'
const FALLBACK_SLICE_OFFSETS = [7, 9, 13] as const

interface PasswordCandidate {
  offset: number
  password: string
}

function passwordAt(data: Buffer, offset: number): string | undefined {
  if (!Number.isInteger(offset) || offset < 0 || offset >= data.length) {
    return undefined
  }
  const password = stripSecret(data.subarray(offset).toString('utf8'))
  return password.length > 0 ? password : undefined
}

function indexesOfPrefix(data: Buffer, prefix: string): number[] {
  const marker = Buffer.from(prefix, 'utf8')
  const offsets: number[] = []
  let from = 0
  while (from < data.length) {
    const offset = data.indexOf(marker, from)
    if (offset < 0) {
      break
    }
    offsets.push(offset)
    from = offset + 1
  }
  return offsets
}

/**
 * Decode one local-password record and drop trailing NUL bytes.
 *
 * A common 38-byte packet has a 7-byte header and a 30-character password
 * that starts with `:1:` at offset 7. Slicing at 13, or at 9 after a 2-byte
 * chunk, drops that prefix. The robot then refuses MQTT with
 * "Bad username or password".
 *
 * When `:1:` is present, slice from that byte. The longest such candidate
 * wins over the shorter slices at 9 and 13. A packet with no `:1:` prefix
 * keeps `sliceFrom` (13, or 9 when the first TLS chunk was 2 bytes). Not
 * every robot sends `:1:`.
 */
export function decodePasswordPayload(data: Buffer, sliceFrom = 13): string | undefined {
  if (data.length <= 7) {
    return undefined
  }

  const seen = new Set<number>([
    ...indexesOfPrefix(data, PASSWORD_PREFIX),
    ...FALLBACK_SLICE_OFFSETS,
    sliceFrom,
  ])
  const candidates: PasswordCandidate[] = []
  for (const offset of seen) {
    const password = passwordAt(data, offset)
    if (password) {
      candidates.push({ offset, password })
    }
  }

  const prefixed = candidates.filter(candidate => candidate.password.startsWith(PASSWORD_PREFIX))
  const firstPrefixed = prefixed[0]
  if (firstPrefixed) {
    let winner = firstPrefixed
    for (const candidate of prefixed) {
      if (candidate.password.length > winner.password.length) {
        winner = candidate
      }
    }
    return winner.password
  }

  return candidates.find(candidate => candidate.offset === sliceFrom)?.password
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

/**
 * The robot presents a self-signed certificate. Verification stays off unless
 * ROOMBA_TLS_VERIFY=1, and the socket is opened only to the configured robot IP.
 */
export function robotTlsOptions(): tls.ConnectionOptions {
  const options: tls.ConnectionOptions = {
    rejectUnauthorized: process.env.ROOMBA_TLS_VERIFY === '1',
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
    // Used only when the packet has no `:1:` prefix. A 2-byte first chunk
    // means the next record's legacy password starts at 9 instead of 13.
    let sliceFrom = 13
    let wrote = false
    const socket = (connect ?? defaultConnect)(PASSWORD_PORT, ip, robotTlsOptions())
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
  setBroadcast?: (flag: boolean) => void
}

export async function discoverLocalRobots(options?: {
  timeoutMs?: number
  createSocket?: () => LookupSocket
}): Promise<Array<{ blid: string, ip: string }>> {
  const timeoutMs = options?.timeoutMs ?? 4_000
  const factory = options?.createSocket ?? (() => createSocket('udp4') as DgramSocket)
  return await new Promise((resolve) => {
    const found = new Map<string, string>()
    let settled = false
    const socket = factory()
    const finish = () => {
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
      resolve([...found].map(([blid, ip]) => ({ blid, ip })))
    }
    const timer = setTimeout(finish, timeoutMs)
    socket.on('error', () => finish())
    socket.on('message', (message: Buffer) => {
      const parsed = parseRobotAnnouncement(message)
      if (parsed?.blid && parsed.ip) {
        found.set(stripSecret(parsed.blid), parsed.ip)
      }
    })
    try {
      socket.bind(0, () => {
        try {
          socket.setBroadcast?.(true)
        }
        catch {
          // A test socket may not implement broadcast.
        }
        const message = Buffer.from('irobotmcs')
        socket.send(message, 0, message.length, 5678, '255.255.255.255')
      })
    }
    catch {
      finish()
    }
  })
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
