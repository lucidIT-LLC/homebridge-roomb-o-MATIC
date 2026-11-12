import { describe, expect, it } from 'vitest'

import { discoverCloudRobots, type HttpCall, type HttpResult } from './cloudDiscovery.js'

describe('cloud discovery', () => {
  it('returns a failure on Gigya 403 without echoing the account password', async () => {
    const calls: HttpCall[] = []
    const request = async (call: HttpCall): Promise<HttpResult> => {
      calls.push(call)
      if (call.url.includes('discover/endpoints')) {
        return {
          status: 200,
          body: {
            gigya: { api_key: 'discovered-key', datacenter_domain: 'us1.gigya.com' },
            deployments: { '2024': { httpBase: 'https://example.invalid' } },
          },
        }
      }
      return { status: 403, body: { statusCode: 403, errorMessage: 'denied' } }
    }
    const result = await discoverCloudRobots('person@example.com', 'account-secret', request, 'https://example.invalid/discover/endpoints')
    expect(result.ok).toBe(false)
    expect(result.status).toBe(403)
    expect(JSON.stringify(result)).not.toContain('account-secret')
    expect(calls.some(call => call.body?.includes('account-secret'))).toBe(true)
  })

  it('maps a login payload to local device fields and strips a trailing NUL', async () => {
    const request = async (call: HttpCall): Promise<HttpResult> => {
      if (call.url.includes('discover/endpoints')) {
        return { status: 200, body: { gigya: { api_key: 'key' }, httpBase: 'https://example.invalid' } }
      }
      if (call.url.endsWith('/accounts.login')) {
        return {
          status: 200,
          body: { statusCode: 200, errorCode: 0, UID: 'uid', UIDSignature: 'sig', signatureTimestamp: 1 },
        }
      }
      return {
        status: 200,
        body: {
          robots: {
            'CLOUD-BLID': { name: 'Cloud Roomba', password: 'cloud-password\0', ip: '192.0.2.30', sku: 'i5' },
          },
        },
      }
    }
    const result = await discoverCloudRobots('person@example.com', 'account-secret', request, 'https://example.invalid/discover/endpoints')
    expect(result.ok).toBe(true)
    expect(result.robots).toEqual([{
      name: 'Cloud Roomba',
      blid: 'CLOUD-BLID',
      robotpwd: 'cloud-password',
      ipaddress: '192.0.2.30',
      model: 'i5',
      softwareVer: undefined,
    }])
  })
})
