import { describe, expect, it, vi } from 'vitest'

import { listMapsFromState, readRobotMaps } from './pmap.js'
import { runListRooms } from './cli/list-rooms.js'

describe('pmap listing', () => {
  it('reads pmap and region ids and drops secrets that arrived in the state', () => {
    const maps = listMapsFromState({
      password: 'do-not-print',
      blid: 'do-not-print',
      pmaps: [{ pmap_id: 'pmap-1', user_pmapv_id: 'ver-1', state: 'active' }],
      lastCommand: {
        pmap_id: 'pmap-1',
        user_pmapv_id: 'ver-1',
        regions: [{ region_id: '3', region_name: 'Office', type: 'rid' }],
      },
    })
    expect(maps).toEqual([{
      pmapId: 'pmap-1',
      userPmapvId: 'ver-1',
      regions: [{ id: '3', name: 'Office', type: 'rid' }],
    }])
    expect(JSON.stringify(maps)).not.toContain('do-not-print')
  })

  it('prints maps from a connected robot without printing the password', async () => {
    const lines: string[] = []
    const code = await runListRooms(['--ip', '192.0.2.10', '--blid', 'SECRETBLID', '--password', 'SECRETPWD'], {
      connect: () => ({
        getRobotState: vi.fn(async () => ({
          password: 'SECRETPWD',
          pmaps: [{ pmap_id: 'pmap-9', user_pmapv_id: 'ver-9', regions: [{ region_id: '4', region_name: 'Den' }] }],
        })),
        end: vi.fn(),
      }),
      error: line => lines.push(line),
      write: line => lines.push(line),
    })
    expect(code).toBe(0)
    expect(lines.join('\n')).toContain('pmap-9')
    expect(lines.join('\n')).toContain('Den')
    expect(lines.join('\n')).not.toContain('SECRETPWD')
    expect(lines.join('\n')).not.toContain('SECRETBLID')
  })

  it('times out when the robot never sends map fields', async () => {
    await expect(readRobotMaps({
      getRobotState: () => new Promise(() => undefined),
    }, 5)).rejects.toThrow(/Timed out/)
  })
})
