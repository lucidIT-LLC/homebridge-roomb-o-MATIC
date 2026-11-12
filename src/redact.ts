const SECRET_KEYS = new Set(['blid', 'password', 'passwd', 'robotpwd'])

export function cleanCredential(value: string): string {
  let current = value
  let previous = ''
  while (current !== previous) {
    previous = current
    current = current.replace(/\0+$/g, '').trim()
  }
  return current
}

export function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(item => redactValue(item))
  }
  if (!value || typeof value !== 'object') {
    return value
  }
  const redacted: Record<string, unknown> = {}
  for (const [key, inner] of Object.entries(value)) {
    if (SECRET_KEYS.has(key.toLowerCase())) {
      redacted[key] = '[redacted]'
    }
    else {
      redacted[key] = redactValue(inner)
    }
  }
  return redacted
}

export function safeError(error: unknown, secrets: Array<string | undefined> = []): string {
  let text = error instanceof Error ? error.message : String(error)
  for (const secret of secrets) {
    if (secret) {
      text = text.split(secret).join('[redacted]')
    }
  }
  return text
}

export function publicSerial(seed: string): string {
  let hash = 0
  for (let index = 0; index < seed.length; index += 1) {
    hash = (Math.imul(hash, 31) + seed.charCodeAt(index)) >>> 0
  }
  return `roomba-${hash.toString(16).padStart(8, '0')}`
}
