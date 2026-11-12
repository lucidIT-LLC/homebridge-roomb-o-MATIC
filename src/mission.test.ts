import { describe, expect, it, vi } from 'vitest'

import { buildMatterDefinition, rvcCleanModeCluster } from './matterVacuum.js'
import { buildCleanRoomMission, passesForMode, RVC_CLEAN_MODES, startMission } from './mission.js'

describe('clean missions and Matter modes', () => {
  it('advertises between 2 and 255 RvcCleanMode modes', () => {
    const cluster = rvcCleanModeCluster('automatic')
    expect(cluster.supportedModes.length).toBeGreaterThanOrEqual(2)
    expect(cluster.supportedModes.length).toBeLessThanOrEqual(255)
    expect(cluster.supportedModes.map(mode => mode.label)).toEqual(['Automatic', 'Deep Clean', 'Quick'])
    expect(RVC_CLEAN_MODES).toHaveLength(3)
    expect(RVC_CLEAN_MODES.map(({ label, modeTags }) => ({ label, modeTags }))).toEqual([
      { label: 'Automatic', modeTags: [{ value: 0 }, { value: 16385 }] },
      { label: 'Deep Clean', modeTags: [{ value: 16384 }, { value: 16385 }] },
      { label: 'Quick', modeTags: [{ value: 1 }, { value: 16385 }] },
    ])
  })

  it('maps a room selection to a cleanRoom mission with twoPass for deep clean', async () => {
    const mission = buildCleanRoomMission({
      mode: 'deep',
      pmapId: 'pmap-1',
      userPmapvId: 'version-1',
      rooms: [
        { id: '5', name: 'Hall' },
        { id: '1', name: 'Kitchen' },
      ],
      selectedRoomIds: ['5'],
    })
    expect(mission).toEqual({
      ordered: 1,
      pmap_id: 'pmap-1',
      user_pmapv_id: 'version-1',
      regions: [{ region_id: '5', region_name: 'Hall', type: 'rid' }],
      twoPass: true,
      noAutoPasses: true,
    })
    expect(passesForMode('quick')).toEqual({ twoPass: false, noAutoPasses: true })
    expect(passesForMode('automatic')).toEqual({ twoPass: false, noAutoPasses: false })

    const robot = {
      start: vi.fn(async () => ({ ok: null })),
      cleanRoom: vi.fn(async () => ({ ok: null })),
      setCleaningPassesTwo: vi.fn(async () => ({ ok: null })),
    }
    const result = await startMission(robot, {
      mode: 'deep',
      pmapId: 'pmap-1',
      userPmapvId: 'version-1',
      rooms: [{ id: '5', name: 'Hall' }],
      selectedRoomIds: ['5'],
    })
    expect(result).toBe('rooms')
    expect(robot.setCleaningPassesTwo).toHaveBeenCalledOnce()
    expect(robot.cleanRoom).toHaveBeenCalledWith(mission)
    expect(robot.start).not.toHaveBeenCalled()
  })

  it('puts the same mode list on a Matter vacuum definition', () => {
    const definition = buildMatterDefinition({
      uuid: 'matter-1',
      name: 'Roomba',
      serialNumber: 'roomba-abc',
      deviceType: { name: 'RoboticVacuumCleaner' },
      cleanMode: 'automatic',
      rooms: [{ id: '2', name: 'Study' }],
      selectedRoomIds: ['2'],
      handlers: {
        changeCleanMode: async () => undefined,
        changeRunMode: async () => undefined,
        selectAreas: async () => undefined,
        pause: async () => undefined,
        resume: async () => undefined,
        goHome: async () => undefined,
      },
    })
    const cleanMode = definition.clusters.rvcCleanMode as {
      supportedModes: Array<{ label: string, modeTags: Array<{ value: number }> }>
    }
    expect(cleanMode.supportedModes.map(({ label, modeTags }) => ({ label, modeTags }))).toEqual([
      { label: 'Automatic', modeTags: [{ value: 0 }, { value: 16385 }] },
      { label: 'Deep Clean', modeTags: [{ value: 16384 }, { value: 16385 }] },
      { label: 'Quick', modeTags: [{ value: 1 }, { value: 16385 }] },
    ])
    expect(cleanMode.supportedModes.length).toBeGreaterThanOrEqual(2)
    expect(cleanMode.supportedModes.length).toBeLessThanOrEqual(255)
    const serviceArea = definition.clusters.serviceArea as { supportedAreas: Array<{ areaId: number, mapId: null }>, selectedAreas: number[] }
    expect(serviceArea.supportedAreas[0]).toMatchObject({ areaId: 2, mapId: null })
    expect(serviceArea.selectedAreas).toEqual([2])
    expect(definition.context).toEqual({})
  })
})
