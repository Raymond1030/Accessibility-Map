import { describe, expect, it } from 'vitest'
import { advanceStory, measureRoute, routeAtProgress, SCENE_DURATIONS } from './story'
import { parseIntroRoute } from './directions'

describe('intro playback clock', () => {
  it('crosses scene boundaries without losing the leftover time', () => {
    expect(advanceStory({ scene: 0, elapsed: 4000 }, 600)).toEqual({ scene: 1, elapsed: 400 })
  })
  it('loops from the last scene into the first', () => {
    expect(advanceStory({ scene: 3, elapsed: SCENE_DURATIONS[3] - 200 }, 400)).toEqual({ scene: 0, elapsed: 200 })
  })
  it('preserves a paused playhead and can resume from that exact point', () => {
    const paused = { scene: 1, elapsed: 2700 }
    expect(advanceStory(paused, 0)).toEqual(paused)
    expect(advanceStory(paused, 100)).toEqual({ scene: 1, elapsed: 2800 })
  })
  it('handles whole loops and invalid time without corrupting the scene', () => {
    const clock = { scene: 2, elapsed: 400 }
    expect(advanceStory(clock, SCENE_DURATIONS.reduce((a, b) => a + b, 0) * 3)).toEqual(clock)
    expect(advanceStory(clock, NaN)).toEqual(clock)
  })
})

describe('real route reveal', () => {
  const route = measureRoute([[0, 0], [.001, 0], [.01, 0]])
  it('moves by traveled distance instead of vertex index', () => {
    expect(routeAtProgress(route, .5).point.geometry.coordinates[0]).toBeCloseTo(.005, 6)
  })
  it('keeps all traversed road bends in the revealed path', () => {
    const curved = measureRoute([[0, 0], [.002, .002], [.01, .002]])
    expect(routeAtProgress(curved, .8).line.geometry.coordinates[1]).toEqual([.002, .002])
  })
  it('clamps endpoints and never overshoots the road', () => {
    expect(routeAtProgress(route, -1).point.geometry.coordinates).toEqual([0, 0])
    expect(routeAtProgress(route, 2).point.geometry.coordinates).toEqual([.01, 0])
    expect(routeAtProgress(route, 1).line.geometry.coordinates).toEqual(route.coordinates)
  })
  it('handles repeated points, while rejecting routes with no movement', () => {
    const repeated = measureRoute([[0, 0], [0, 0], [.01, 0]])
    expect(routeAtProgress(repeated, 0).point.geometry.coordinates).toEqual([0, 0])
    expect(routeAtProgress(repeated, .5).point.geometry.coordinates[0]).toBeCloseTo(.005, 6)
    expect(() => measureRoute([[0, 0], [0, 0]])).toThrow()
  })
})

describe('directions response validation', () => {
  const valid = { code: 'Ok', routes: [{ distance: 12000, duration: 1400, geometry: { type: 'LineString', coordinates: [[113.95, 22.54], [114.05, 22.54]] } }] }
  it('preserves provider distance and duration for the on-screen estimate', () => {
    expect(parseIntroRoute(valid)).toMatchObject({ meters: 12000, seconds: 1400 })
  })
  it.each([null, { code: 'NoRoute', routes: [] }, { code: 'Ok', routes: [] }, { code: 'Ok', routes: [{ ...valid.routes[0], duration: -1 }] }, { code: 'Ok', routes: [{ ...valid.routes[0], geometry: { type: 'LineString', coordinates: [[999, 22], [114, 22]] } }] }])('rejects incomplete or invalid responses: %j', body => {
    expect(() => parseIntroRoute(body)).toThrow()
  })
})
