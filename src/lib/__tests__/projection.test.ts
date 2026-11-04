import { describe, it, expect } from 'vitest'
import {
  parseFallbackDays,
  workingDays,
  storeWorkingDays,
  computeProjection,
  calcCategoryStats,
} from '../projection'

describe('parseFallbackDays', () => {
  it('parses valid ISO weekdays and falls back safely', () => {
    expect(parseFallbackDays('1,2,3,4,5,6')).toEqual([1, 2, 3, 4, 5, 6])
    expect(parseFallbackDays('1,2,9')).toEqual([1, 2])
    expect(parseFallbackDays('')).toEqual([1, 2, 3, 4, 5, 6])
    expect(parseFallbackDays(null)).toEqual([1, 2, 3, 4, 5, 6])
  })
})

describe('workingDays', () => {
  it('uses scheduled shifts excluding repo and adeia', () => {
    const days = workingDays(
      '2026-11',
      [
        { date: '2026-11-02', shift_type: 'split' },
        { date: '2026-11-03', shift_type: 'repo' },
        { date: '2026-11-04', shift_type: 'adeia' },
      ],
      [1, 2, 3, 4, 5, 6],
    )
    expect(days).toEqual(['2026-11-02'])
  })

  it('falls back to the configured weekdays when the schedule is empty', () => {
    const days = workingDays('2026-11', [], [1, 2, 3, 4, 5])
    expect(days).toHaveLength(21)
  })
})

describe('storeWorkingDays', () => {
  it('uses calendar rows over the fallback', () => {
    const days = storeWorkingDays(
      '2026-11',
      [
        { date: '2026-11-01', is_working: true },
        { date: '2026-11-02', is_working: true },
        { date: '2026-11-03', is_working: false },
      ],
      [1, 2, 3, 4, 5, 6],
    )
    expect(days).toEqual(['2026-11-01', '2026-11-02'])
  })
})

describe('computeProjection', () => {
  it('extrapolates points based on elapsed working days', () => {
    const shifts = [
      { date: '2026-11-02', shift_type: 'split' },
      { date: '2026-11-03', shift_type: 'short' },
      { date: '2026-11-04', shift_type: 'split' },
      { date: '2026-11-05', shift_type: 'short' },
    ]
    const result = computeProjection(
      [
        { date: '2026-11-02', points: 2 },
        { date: '2026-11-03', points: 1 },
      ],
      shifts,
      '2026-11',
      new Date('2026-11-03T12:00:00Z'),
      [1],
    )
    expect(result).toEqual({ total: 3, projection: 6, elapsed: 2, totalWorking: 4 })
  })

  it('does not divide by zero when no working day has elapsed', () => {
    const result = computeProjection(
      [{ date: '2026-11-10', points: 5 }],
      [],
      '2026-11',
      new Date('2026-11-01T12:00:00Z'),
      [1, 2, 3, 4, 5, 6],
    )
    expect(result.projection).toBe(0)
  })
})

describe('calcCategoryStats', () => {
  const days = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06']
  const today = new Date('2026-11-04T12:00:00Z')

  it('calculates achievement, projection, deviation and required daily for counts', () => {
    const stats = calcCategoryStats(50, 100, days, today, 'count')
    expect(stats.achievement).toBe(50)
    expect(stats.projection).toBe(83)
    expect(stats.deviation).toBe(-17)
    expect(stats.requiredDaily).toBe(25)
    expect(stats.elapsed).toBe(3)
    expect(stats.remaining).toBe(2)
  })

  it('rounds currency values to 2 decimals', () => {
    const stats = calcCategoryStats(100.5, 200, days, today, 'currency')
    expect(stats.projection).toBe(167.5)
    expect(stats.requiredDaily).toBe(49.75)
  })

  it('returns null values when the target is zero', () => {
    const stats = calcCategoryStats(10, 0, days, today, 'count')
    expect(stats.achievement).toBeNull()
    expect(stats.deviation).toBeNull()
    expect(stats.requiredDaily).toBeNull()
  })
})
