#!/usr/bin/env node
import { pathToFileURL } from 'node:url'

import { captureLocalPassword, lookupBlid } from '../passwordCapture.js'
import { readHomebridgeConfig, writeDeviceIntoHomebridgeConfig, writeHomebridgeConfig } from '../configFile.js'
import { flagNumber, flagText, parseFlags } from './args.js'

export interface GetPasswordIo {
  capture?: typeof captureLocalPassword
  lookup?: typeof lookupBlid
  readConfig?: typeof readHomebridgeConfig
  writeConfig?: typeof writeHomebridgeConfig
  log?: (message: string) => void
  error?: (message: string) => void
}

const INSTRUCTIONS = [
  'Close the iRobot app. Only one local connection can be open.',
  'For an i-series robot (such as the i5+), press and hold the Home button — the dock / house button — for about 2 seconds, until the robot plays tones.',
  'Do not hold both buttons. That gesture is for 900-series robots.',
  'This command does not wait for a keyboard and does not use a TTY.',
].join(' ')

export async function runGetPassword(argv: string[], io: GetPasswordIo = {}): Promise<number> {
  const log = io.log ?? ((message: string) => console.log(message))
  const error = io.error ?? ((message: string) => console.error(message))
  const flags = parseFlags(argv)
  const ip = flagText(flags, 'ip')
  const configPath = flagText(flags, 'config')
  if (!ip || !configPath) {
    error('Usage: roomb-o-matic-getpassword --ip <robot-ip> --config <config.json> [--blid <blid>] [--name <name>]')
    error(INSTRUCTIONS)
    return 1
  }
  log(INSTRUCTIONS)
  log(`Connecting to ${ip} port 8883.`)
  const capture = io.capture ?? captureLocalPassword
  const lookup = io.lookup ?? lookupBlid
  let password: string
  try {
    password = await capture({
      ip,
      maxAttempts: flagNumber(flags, 'attempts'),
      retryDelayMs: flagNumber(flags, 'retry-ms'),
      onStatus: message => log(message),
    })
  }
  catch (cause) {
    error(cause instanceof Error ? cause.message : 'Password capture failed.')
    return 1
  }
  let blid = flagText(flags, 'blid')
  if (!blid) {
    blid = await lookup(ip)
  }
  if (!blid) {
    error('Could not discover the robot BLID. Re-run with --blid. The password was not printed.')
    return 1
  }
  const readConfig = io.readConfig ?? readHomebridgeConfig
  const writeConfig = io.writeConfig ?? writeHomebridgeConfig
  try {
    const config = readConfig(configPath)
    const next = writeDeviceIntoHomebridgeConfig(config, {
      name: flagText(flags, 'name') ?? 'Roomba',
      blid,
      robotpwd: password,
      ipaddress: ip,
    })
    writeConfig(configPath, next)
  }
  catch (cause) {
    error(cause instanceof Error ? cause.message : 'Could not update the config file.')
    return 1
  }
  log('Stored local credentials. iRobot cloud login is disabled for this platform. The password was not printed.')
  return 0
}

const invokedDirectly = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false
if (invokedDirectly) {
  runGetPassword(process.argv.slice(2)).then((code) => {
    process.exitCode = code
  })
}
