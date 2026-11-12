export interface MapRegion {
  id: string
  name?: string
  type?: string
}

export interface RobotMapSummary {
  pmapId: string
  userPmapvId?: string
  regions: MapRegion[]
}

function text(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim()
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }
  return undefined
}

export function listMapsFromState(state: unknown): RobotMapSummary[] {
  if (!state || typeof state !== 'object') {
    return []
  }
  const record = state as Record<string, unknown>
  const maps = new Map<string, RobotMapSummary>()

  const ensure = (pmapId: string, userPmapvId?: string): RobotMapSummary => {
    const existing = maps.get(pmapId) ?? { pmapId, userPmapvId, regions: [] }
    if (userPmapvId && !existing.userPmapvId) {
      existing.userPmapvId = userPmapvId
    }
    maps.set(pmapId, existing)
    return existing
  }

  const addRegions = (summary: RobotMapSummary, regions: unknown): void => {
    if (!Array.isArray(regions)) {
      return
    }
    for (const region of regions) {
      if (!region || typeof region !== 'object') {
        continue
      }
      const entry = region as Record<string, unknown>
      const id = text(entry.region_id ?? entry.id)
      if (!id || summary.regions.some(existing => existing.id === id)) {
        continue
      }
      summary.regions.push({
        id,
        name: text(entry.region_name ?? entry.name),
        type: text(entry.region_type ?? entry.type),
      })
    }
  }

  const consume = (entry: unknown): void => {
    if (!entry || typeof entry !== 'object') {
      return
    }
    const map = entry as Record<string, unknown>
    const pmapId = text(map.pmap_id ?? map.pmapId)
    if (!pmapId) {
      return
    }
    const summary = ensure(pmapId, text(map.user_pmapv_id ?? map.userPmapvId))
    addRegions(summary, map.regions)
  }

  if (Array.isArray(record.pmaps)) {
    for (const entry of record.pmaps) {
      consume(entry)
    }
  }
  consume(record.lastCommand)
  return [...maps.values()]
}

export async function readRobotMaps(robot: {
  getRobotState?: (fields: string[]) => Promise<unknown>
}, timeoutMs = 12_000): Promise<RobotMapSummary[]> {
  if (!robot.getRobotState) {
    throw new Error('This robot does not expose map state.')
  }
  const state = await Promise.race([
    robot.getRobotState(['pmaps', 'lastCommand']),
    new Promise<never>((_resolve, reject) => {
      setTimeout(() => reject(new Error('Timed out waiting for map data. Close the iRobot app and try again.')), timeoutMs)
    }),
  ])
  return listMapsFromState(state)
}
