import { randomUUID } from 'node:crypto'

import { captureLocalPassword, lookupBlid, stripSecret, type CaptureLocalPasswordOptions } from './passwordCapture.js'

export interface CapturePoll {
  state: 'pending' | 'done' | 'error'
  message: string
  robotpwd?: string
  blid?: string
  ipaddress?: string
  name?: string
}

interface CaptureJob extends CapturePoll {
  state: 'pending' | 'done' | 'error'
}

export class CaptureRegistry {
  private readonly jobs = new Map<string, CaptureJob>()

  constructor(private readonly deps: {
    capture?: typeof captureLocalPassword
    lookup?: typeof lookupBlid
  } = {}) {}

  start(input: { ip: string, name?: string, blid?: string, maxAttempts?: number }): { jobId: string } {
    const jobId = randomUUID()
    const job: CaptureJob = {
      state: 'pending',
      message: 'Waiting for the Home button.',
      ipaddress: input.ip,
      name: input.name?.trim() || 'Roomba',
    }
    this.jobs.set(jobId, job)
    void this.run(job, input)
    return { jobId }
  }

  poll(jobId: string): CapturePoll {
    const job = this.jobs.get(jobId)
    if (!job) {
      return { state: 'error', message: 'Capture session expired.' }
    }
    if (job.state !== 'done') {
      return { state: job.state, message: job.message }
    }
    const result: CapturePoll = {
      state: 'done',
      message: 'Captured. Save the platform config. Cloud login is turned off.',
      robotpwd: job.robotpwd,
      blid: job.blid,
      ipaddress: job.ipaddress,
      name: job.name,
    }
    this.jobs.delete(jobId)
    return result
  }

  private async run(job: CaptureJob, input: { ip: string, blid?: string, maxAttempts?: number }): Promise<void> {
    const capture = this.deps.capture ?? captureLocalPassword
    const lookup = this.deps.lookup ?? lookupBlid
    try {
      const options: CaptureLocalPasswordOptions = {
        ip: input.ip,
        maxAttempts: input.maxAttempts,
        onStatus: (message) => {
          job.message = message
        },
      }
      const password = await capture(options)
      let blid = input.blid ? stripSecret(input.blid) : undefined
      if (!blid) {
        blid = await lookup(input.ip)
      }
      if (!blid) {
        job.state = 'error'
        job.message = 'Password captured, but the BLID was not found. Enter the BLID and try again. The password was not shown.'
        return
      }
      job.robotpwd = stripSecret(password)
      job.blid = blid
      job.state = 'done'
      job.message = 'Captured.'
    }
    catch (error) {
      job.state = 'error'
      job.message = error instanceof Error ? error.message : 'Password capture failed.'
    }
  }
}
