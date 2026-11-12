#!/usr/bin/env node
import { pathToFileURL } from 'node:url'

import dorita980 from 'dorita980'

import { flagText, parseFlags } from './args.js'
import { readRobotMaps, type RobotMapSummary } from '../pmap.js'

export interface ListRoomsIo {
  connect?: (blid: string, password: string, ip: string) => {
    getRobotState?: (fields: string[]) => Promise<unknown>
    end?: () => void
  }
  log?: (message: string) => void
  error?: (message: string) => void
  write?: (message: string) => void
}

export async function runListRooms(argv: string[], io: ListRoomsIo = {}): Promise<number> {
  const error = io.error ?? ((message: string) => console.error(message))
  const write = io.write ?? ((message: string) => process.stdout.write(message))
  const flags = parseFlags(argv)
  const ip = flagText(flags, 'ip')
  const blid = flagText(flags, 'blid')
  const password = flagText(flags, 'password')
  if (!ip || !blid || !password) {
    error('Usage: roomb-o-matic-list-rooms --ip <robot-ip> --blid <blid> --password <password>')
    error('Prints pmap and room ids only. Close the iRobot app first. The password is not printed.')
    return 1
  }
  const connect = io.connect ?? ((robotBlid: string, robotPassword: string, robotIp: string) => {
    return new dorita980.Local(robotBlid, robotPassword, robotIp)
  })
  const robot = connect(blid, password, ip)
  try {
    const maps = await readRobotMaps(robot)
    write(`${JSON.stringify({ maps: maps.map(publicMap) }, null, 2)}\n`)
    return 0
  }
  catch (cause) {
    error(cause instanceof Error ? cause.message : 'Could not read robot maps.')
    return 1
  }
  finally {
    try {
      robot.end?.()
    }
    catch {
      // Closing the local connection is best-effort.
    }
  }
}

function publicMap(map: RobotMapSummary): RobotMapSummary {
  return {
    pmapId: map.pmapId,
    userPmapvId: map.userPmapvId,
    regions: map.regions.map(region => ({
      id: region.id,
      name: region.name,
      type: region.type,
    })),
  }
}

const invokedDirectly = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false
if (invokedDirectly) {
  runListRooms(process.argv.slice(2)).then((code) => {
    process.exitCode = code
  })
}
