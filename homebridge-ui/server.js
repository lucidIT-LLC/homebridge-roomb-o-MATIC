import { HomebridgePluginUiServer } from '@homebridge/plugin-ui-utils'
import dorita980 from 'dorita980'

import { CaptureRegistry } from '../dist/captureSession.js'
import { readRobotMaps } from '../dist/pmap.js'

const registry = new CaptureRegistry()

class UiServer extends HomebridgePluginUiServer {
  constructor() {
    super()

    this.onRequest('/capture-start', (payload = {}) => {
      const ip = typeof payload.ip === 'string' ? payload.ip.trim() : ''
      if (!ip) {
        throw new Error('Robot IP address is required.')
      }
      return registry.start({
        ip,
        name: typeof payload.name === 'string' ? payload.name : undefined,
        blid: typeof payload.blid === 'string' ? payload.blid : undefined,
      })
    })

    this.onRequest('/capture-poll', (payload = {}) => {
      const jobId = typeof payload.jobId === 'string' ? payload.jobId : ''
      return registry.poll(jobId)
    })

    this.onRequest('/list-rooms', async (payload = {}) => {
      const ip = typeof payload.ip === 'string' ? payload.ip.trim() : ''
      const blid = typeof payload.blid === 'string' ? payload.blid.trim() : ''
      const password = typeof payload.robotpwd === 'string' ? payload.robotpwd : ''
      if (!ip || !blid || !password) {
        throw new Error('A saved IP, BLID, and password are required. Close the iRobot app and try again.')
      }
      const robot = new dorita980.Local(blid, password, ip)
      try {
        const maps = await readRobotMaps(robot)
        return { maps }
      }
      finally {
        try {
          robot.end?.()
        }
        catch {
          // The robot may already have closed the local connection.
        }
      }
    })

    this.ready()
  }
}

;(() => new UiServer())()
