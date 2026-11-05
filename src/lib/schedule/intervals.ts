import type { Shift } from '../types'

export interface WorkSegment { start: string; end: string }
export interface ShiftTemplate {
  id: string; store_id: string; code: string; name: string; short_label: string; color: string
  legacy_type: Shift['shift_type']; segments: WorkSegment[]; valid_from: string; valid_to: string | null; active: boolean; revision: number
  last_assigned_date?: string | null
}
export interface StaffingRequirement {
  id: string; store_id: string; template_code: string | null; weekday: number; start_time: string; end_time: string
  minimum: number; valid_from: string; valid_to: string | null; revision: number
}
export function minutes(time: string): number {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return NaN
  const [hours, mins] = time.split(':').map(Number)
  return hours * 60 + mins
}
export function validSegments(value: unknown): value is WorkSegment[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 4) return false
  let end = -1
  for (const segment of value) {
    if (!segment || typeof segment.start !== 'string' || typeof segment.end !== 'string') return false
    const start = minutes(segment.start); const next = minutes(segment.end)
    if (!Number.isFinite(start) || !Number.isFinite(next) || start < end || start >= next) return false
    end = next
  }
  return true
}
export function resolvedSegments(shift?: Shift): WorkSegment[] | null {
  if (!shift || shift.shift_type === 'repo' || shift.shift_type === 'adeia') return []
  if (validSegments(shift.segments)) return shift.segments
  if (shift.shift_type === 'split') return null
  const range = [{ start: shift.start_time?.slice(0, 5) ?? '', end: shift.end_time?.slice(0, 5) ?? '' }]
  return validSegments(range) ? range : null
}
export function segmentHours(segments: WorkSegment[]): number {
  return segments.reduce((sum, segment) => sum + minutes(segment.end) - minutes(segment.start), 0) / 60
}
export function formatSegments(segments: WorkSegment[]): string { return segments.map((segment) => `${segment.start}–${segment.end}`).join(' / ') }
export function templateApplies(template: ShiftTemplate, date: string): boolean {
  return template.active && template.valid_from <= date && (!template.valid_to || template.valid_to >= date)
}
