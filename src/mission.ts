import type { CleanMode, RoomConfig } from './settings.js'

export const CLEAN_MODE_AUTOMATIC = 0
export const CLEAN_MODE_DEEP = 1
export const CLEAN_MODE_QUICK = 2

export const RUN_MODE_IDLE = 0
export const RUN_MODE_CLEANING = 1

export interface ModeOption {
  label: string
  mode: number
  modeTags: Array<{ value: number }>
}

/**
 * Matter ModeBase requires 2–255 supported modes. One mode fails accessory
 * registration on Homebridge 2.5 / Matter.js 0.18.
 */
export const RVC_CLEAN_MODES: ModeOption[] = [
  { label: 'Automatic', mode: CLEAN_MODE_AUTOMATIC, modeTags: [{ value: 0 }, { value: 16385 }] },
  { label: 'Deep Clean', mode: CLEAN_MODE_DEEP, modeTags: [{ value: 16384 }] },
  { label: 'Quick', mode: CLEAN_MODE_QUICK, modeTags: [{ value: 1 }] },
]

export const RVC_RUN_MODES: ModeOption[] = [
  { label: 'Idle', mode: RUN_MODE_IDLE, modeTags: [{ value: 16384 }] },
  { label: 'Cleaning', mode: RUN_MODE_CLEANING, modeTags: [{ value: 16385 }] },
]

export interface CleaningPasses {
  twoPass: boolean
  noAutoPasses: boolean
}

export function assertSupportedModeCount(modes: readonly unknown[]): void {
  if (modes.length < 2 || modes.length > 255) {
    throw new Error(`RvcCleanMode supportedModes must contain 2 to 255 modes (received ${modes.length}).`)
  }
}

export function passesForMode(mode: CleanMode): CleaningPasses {
  switch (mode) {
    case 'automatic':
      return { twoPass: false, noAutoPasses: false }
    case 'deep':
      return { twoPass: true, noAutoPasses: true }
    case 'quick':
      return { twoPass: false, noAutoPasses: true }
    default: {
      const unexpected: never = mode
      return unexpected
    }
  }
}

export function cleanModeFromNumber(mode: number): CleanMode | undefined {
  switch (mode) {
    case CLEAN_MODE_AUTOMATIC:
      return 'automatic'
    case CLEAN_MODE_DEEP:
      return 'deep'
    case CLEAN_MODE_QUICK:
      return 'quick'
    default:
      return undefined
  }
}

export function modeNumber(mode: CleanMode): number {
  switch (mode) {
    case 'automatic':
      return CLEAN_MODE_AUTOMATIC
    case 'deep':
      return CLEAN_MODE_DEEP
    case 'quick':
      return CLEAN_MODE_QUICK
    default: {
      const unexpected: never = mode
      return unexpected
    }
  }
}

export interface MatterRoomArea {
  areaId: number
  roomId: string
  name: string
}

export function matterRoomAreas(rooms: RoomConfig[]): MatterRoomArea[] {
  const used = new Set<number>()
  return rooms.map((room, index) => {
    let areaId = index + 1
    if (/^\d+$/.test(room.id)) {
      const parsed = Number(room.id)
      if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 0xFFFFFF && !used.has(parsed)) {
        areaId = parsed
      }
    }
    while (used.has(areaId)) {
      areaId += 1
    }
    used.add(areaId)
    return {
      areaId,
      roomId: room.id,
      name: room.name,
    }
  })
}

export interface CleanRoomMission {
  ordered: 1
  pmap_id: string
  user_pmapv_id?: string
  regions: Array<{ region_id: string, region_name: string, type: 'rid' }>
  twoPass: boolean
  noAutoPasses: boolean
}

export function buildCleanRoomMission(input: {
  mode: CleanMode
  pmapId?: string
  userPmapvId?: string
  rooms: RoomConfig[]
  selectedRoomIds: string[]
}): CleanRoomMission | undefined {
  if (!input.pmapId || input.selectedRoomIds.length === 0) {
    return undefined
  }
  const selected = new Set(input.selectedRoomIds)
  const rooms = input.rooms.filter(room => selected.has(room.id))
  if (rooms.length === 0) {
    return undefined
  }
  const passes = passesForMode(input.mode)
  return {
    ordered: 1,
    pmap_id: input.pmapId,
    user_pmapv_id: input.userPmapvId,
    regions: rooms.map(room => ({
      region_id: room.id,
      region_name: room.name,
      type: 'rid',
    })),
    twoPass: passes.twoPass,
    noAutoPasses: passes.noAutoPasses,
  }
}

export interface RobotCommander {
  start: () => Promise<unknown>
  cleanRoom?: (args: object) => Promise<unknown>
  setCleaningPassesAuto?: () => Promise<unknown>
  setCleaningPassesOne?: () => Promise<unknown>
  setCleaningPassesTwo?: () => Promise<unknown>
}

export async function applyCleaningPasses(robot: RobotCommander, mode: CleanMode): Promise<void> {
  switch (mode) {
    case 'automatic':
      if (robot.setCleaningPassesAuto) {
        await robot.setCleaningPassesAuto()
      }
      return
    case 'deep':
      if (robot.setCleaningPassesTwo) {
        await robot.setCleaningPassesTwo()
      }
      return
    case 'quick':
      if (robot.setCleaningPassesOne) {
        await robot.setCleaningPassesOne()
      }
      return
    default: {
      const unexpected: never = mode
      throw new Error(`Unknown clean mode ${String(unexpected)}`)
    }
  }
}

export async function startMission(robot: RobotCommander, input: {
  mode: CleanMode
  pmapId?: string
  userPmapvId?: string
  rooms: RoomConfig[]
  selectedRoomIds: string[]
}): Promise<'rooms' | 'everywhere'> {
  await applyCleaningPasses(robot, input.mode)
  const mission = buildCleanRoomMission(input)
  if (mission) {
    if (!robot.cleanRoom) {
      throw new Error('This robot client cannot start a room mission.')
    }
    await robot.cleanRoom(mission)
    return 'rooms'
  }
  await robot.start()
  return 'everywhere'
}
