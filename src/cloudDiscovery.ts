import { cleanCredential } from './redact.js'
import type { DeviceConfig } from './settings.js'

export interface CloudDiscoveryResult {
  ok: boolean
  robots: DeviceConfig[]
  status?: number
}

export interface HttpCall {
  url: string
  method: 'GET' | 'POST'
  headers?: Record<string, string>
  body?: string
}

export interface HttpResult {
  status: number
  body: unknown
}

export type HttpRequest = (call: HttpCall) => Promise<HttpResult>

const APP_ID = 'ANDROID-C7FB240E-DF34-42D7-AE4E-A8C17079A294'

export async function defaultHttpRequest(call: HttpCall): Promise<HttpResult> {
  const response = await fetch(call.url, {
    method: call.method,
    headers: call.headers,
    body: call.body,
  })
  const text = await response.text()
  let body: unknown = text
  if (text) {
    try {
      body = JSON.parse(text) as unknown
    }
    catch {
      body = text
    }
  }
  return { status: response.status, body }
}

interface Endpoints {
  apiKey: string
  gigyaBase: string
  httpBase: string
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }
  return value as Record<string, unknown>
}

function pickHttpBase(deployments: unknown): string | undefined {
  const entries = record(deployments)
  if (!entries) {
    return undefined
  }
  const keys = Object.keys(entries).sort().reverse()
  for (const key of keys) {
    const deployment = record(entries[key])
    if (typeof deployment?.httpBase === 'string') {
      return deployment.httpBase
    }
  }
  return undefined
}

async function discoverEndpoints(request: HttpRequest, discoveryUrl: string): Promise<Endpoints> {
  if (process.env.GIGYA_API_KEY && process.env.GIGYA_BASE && process.env.IROBOT_HTTP_BASE) {
    return {
      apiKey: process.env.GIGYA_API_KEY,
      gigyaBase: process.env.GIGYA_BASE,
      httpBase: process.env.IROBOT_HTTP_BASE,
    }
  }
  const response = await request({ url: discoveryUrl, method: 'GET' })
  if (response.status >= 400) {
    throw new Error(`iRobot endpoint discovery failed (${response.status}).`)
  }
  const body = record(response.body)
  const gigya = record(body?.gigya)
  const apiKey = process.env.GIGYA_API_KEY || (typeof gigya?.api_key === 'string' ? gigya.api_key : '')
  if (!apiKey) {
    throw new Error('iRobot endpoint discovery did not include a Gigya API key.')
  }
  const datacenter = typeof gigya?.datacenter_domain === 'string' ? gigya.datacenter_domain : ''
  const gigyaBase = process.env.GIGYA_BASE
    || (datacenter ? `https://accounts.${datacenter}` : 'https://accounts.us1.gigya.com')
  const httpBase = process.env.IROBOT_HTTP_BASE
    || pickHttpBase(body?.deployments)
    || (typeof body?.httpBase === 'string' ? body.httpBase : '')
    || 'https://unauth2.prod.iot.irobotapi.com'
  return { apiKey, gigyaBase, httpBase }
}

function robotsFromLogin(body: unknown): DeviceConfig[] {
  const parsed = record(body)
  const robots = record(parsed?.robots)
  if (!robots) {
    return []
  }
  const devices: DeviceConfig[] = []
  for (const [blid, value] of Object.entries(robots)) {
    const robot = record(value)
    const password = typeof robot?.password === 'string' ? cleanCredential(robot.password) : ''
    if (!password) {
      continue
    }
    const ipValue = robot?.ip ?? robot?.ipaddress ?? robot?.localIp
    devices.push({
      name: typeof robot?.name === 'string' && robot.name.trim() ? robot.name.trim() : 'Roomba',
      blid: cleanCredential(blid),
      robotpwd: password,
      ipaddress: typeof ipValue === 'string' ? ipValue.trim() : '',
      model: typeof robot?.sku === 'string' ? robot.sku : undefined,
      softwareVer: typeof robot?.softwareVer === 'string' ? robot.softwareVer : undefined,
    })
  }
  return devices
}

/**
 * Cloud login using dorita980 4.x endpoint discovery. Failures return ok:false
 * and never include the account password in the result.
 */
export async function discoverCloudRobots(
  email: string,
  password: string,
  request: HttpRequest = defaultHttpRequest,
  discoveryUrl = process.env.IROBOT_DISCOVERY_URL
    || `https://disc-prod.iot.irobotapi.com/v1/discover/endpoints?country_code=${process.env.IROBOT_COUNTRY_CODE || 'US'}`,
): Promise<CloudDiscoveryResult> {
  try {
    const endpoints = await discoverEndpoints(request, discoveryUrl)
    const form = new URLSearchParams({
      apiKey: endpoints.apiKey,
      targetenv: 'mobile',
      loginID: email,
      password,
      format: 'json',
      targetEnv: 'mobile',
    })
    const gigya = await request({
      url: `${endpoints.gigyaBase}/accounts.login`,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Connection': 'close' },
      body: form.toString(),
    })
    const gigyaBody = record(gigya.body)
    const gigyaStatus = typeof gigyaBody?.statusCode === 'number' ? gigyaBody.statusCode : gigya.status
    if (gigya.status === 401 || gigya.status === 403 || gigyaStatus === 401 || gigyaStatus === 403) {
      return { ok: false, robots: [], status: 403 }
    }
    if (gigya.status >= 400 || gigyaStatus >= 400 || gigyaBody?.errorCode) {
      return { ok: false, robots: [], status: gigya.status }
    }
    if (!gigyaBody?.UID || !gigyaBody.UIDSignature || !gigyaBody.signatureTimestamp) {
      return { ok: false, robots: [], status: gigya.status }
    }
    const login = await request({
      url: `${endpoints.httpBase}/v2/login`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Connection': 'close' },
      body: JSON.stringify({
        app_id: APP_ID,
        assume_robot_ownership: 0,
        gigya: {
          signature: gigyaBody.UIDSignature,
          timestamp: gigyaBody.signatureTimestamp,
          uid: gigyaBody.UID,
        },
      }),
    })
    if (login.status === 401 || login.status === 403) {
      return { ok: false, robots: [], status: login.status }
    }
    if (login.status >= 400) {
      return { ok: false, robots: [], status: login.status }
    }
    return { ok: true, robots: robotsFromLogin(login.body), status: login.status }
  }
  catch {
    return { ok: false, robots: [], status: 0 }
  }
}
