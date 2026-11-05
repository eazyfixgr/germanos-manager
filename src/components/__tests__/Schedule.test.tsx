// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Schedule from '../../pages/Schedule'
import { LeaveRequestForm } from '../schedule/LeaveRequests'
import type { ScheduleData } from '../../lib/schedule/model'

const backend = vi.hoisted(() => ({
  calls: [] as Record<string, string>[], fail: false, deferOwn: false,
  resolveOwn: null as null | ((value: unknown) => void), saveError: null as string | null,
}))
vi.mock('../../lib/auth', () => ({ useAuth: () => ({
  profile: { id: 'one' }, store: { id: 'store', name: 'Κατάστημα δοκιμής' }, isAdmin: true, isMaster: false,
}) }))
vi.mock('../../lib/activity', () => ({ logActivity: vi.fn(async () => {}) }))
function payload(args: Record<string, string>): ScheduleData {
  const own = args.p_scope === 'own'
  return { store_id: args.p_store, start: args.p_start, end: args.p_end, scope: own ? 'own' : 'team', can_manage: true, min_staff: 1,
    staff: [{ id: 'one', full_name: 'Μαρία Δοκιμή', active: true }, ...(!own ? [{ id: 'two', full_name: 'Νίκος Δοκιμή', active: true }] : [])],
    shifts: [{ id: 's1', store_id: 'store', user_id: 'one', date: '2026-11-05', shift_type: 'full' as const, start_time: '09:00', end_time: '15:00', note: null },
      ...(!own ? [{ id: 's2', store_id: 'store', user_id: 'two', date: '2026-11-05', shift_type: 'repo' as const, start_time: null, end_time: null, note: null }] : [])]
      .filter((shift) => shift.date >= args.p_start && shift.date < args.p_end),
    leaves: [], calendar: [], patterns: Array.from({ length: 7 }, (_, i) => ({ store_id: 'store', weekday: i + 1, closed: i === 6,
      level: 'full' as const, start_time: '09:00', end_time: '21:00', note: null })),
  }
}
vi.mock('../../lib/supabase', () => ({ supabase: {
  rpc: vi.fn(async (name: string, args: Record<string, string>) => {
    if (name !== 'read_schedule') return { data: null, error: null }
    backend.calls.push(args)
    if (backend.fail) return { data: null, error: { code: 'PGRST202' } }
    if (args.p_scope === 'own' && backend.deferOwn) return new Promise((resolve) => { backend.resolveOwn = resolve })
    return { data: payload(args), error: null }
  }),
  from: vi.fn(() => ({ insert: () => ({ select: () => ({ single: async () => ({ data: null, error: backend.saveError ? { message: backend.saveError } : null }) }) }) })),
} }))

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-05T12:00:00Z'))
  backend.calls = []; backend.fail = false; backend.deferOwn = false; backend.resolveOwn = null; backend.saveError = null
})
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('Workforce W1 UI', () => {
  it('opens the real day analysis from the monthly calendar and restores keyboard focus', async () => {
    render(<Schedule />)
    await screen.findByText('Φορτώθηκε η επιλεγμένη περίοδος')
    expect(backend.calls[0]).toMatchObject({ p_start: '2026-10-26', p_end: '2026-12-07', p_scope: 'team' })
    expect(screen.queryByText('Πλήρης κάλυψη')).toBeNull()
    const day = document.querySelector<HTMLButtonElement>('[data-date="2026-11-05"]')!
    day.focus(); fireEvent.click(day)
    const dialog = screen.getByRole('dialog', { name: 'Πρόγραμμα ημέρας' })
    expect(within(dialog).getByRole('heading', { name: 'Προγραμματισμένες βάρδιες' })).toBeTruthy()
    expect(within(dialog).getByRole('heading', { name: 'Απουσίες & ρεπό' })).toBeTruthy()
    expect(within(dialog).getByText('Μαρία Δοκιμή')).toBeTruthy()
    expect(within(dialog).getByText('Νίκος Δοκιμή')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(day)
  })
  it('switches to a bounded week and navigates to the next period', async () => {
    render(<Schedule />); await screen.findByText('Φορτώθηκε η επιλεγμένη περίοδος')
    fireEvent.click(screen.getByRole('button', { name: 'Εβδομάδα' }))
    await screen.findByRole('table', { name: 'Πρόγραμμα εβδομάδας ανά εργαζόμενο' })
    expect(backend.calls.at(-1)).toMatchObject({ p_start: '2026-11-02', p_end: '2026-11-09' })
    fireEvent.click(screen.getByRole('button', { name: 'Επόμενη περίοδος' }))
    await waitFor(() => expect(backend.calls.at(-1)?.p_start).toBe('2026-11-09'))
    expect(backend.calls.at(-1)?.p_end).toBe('2026-11-16')
  })
  it('hides cached team data immediately when switching to a still-loading personal scope', async () => {
    render(<Schedule />); await screen.findByText('Φορτώθηκε η επιλεγμένη περίοδος')
    fireEvent.click(screen.getByRole('button', { name: 'Εβδομάδα' })); await screen.findByText('Νίκος Δοκιμή')
    backend.deferOwn = true
    fireEvent.click(screen.getByRole('button', { name: 'Το πρόγραμμά μου' }))
    expect(screen.queryByText('Νίκος Δοκιμή')).toBeNull()
    await waitFor(() => expect(backend.resolveOwn).not.toBeNull())
    await act(async () => { backend.resolveOwn?.({ data: payload(backend.calls.at(-1)!), error: null }) })
    expect(screen.queryByText('Νίκος Δοκιμή')).toBeNull()
    expect(screen.getAllByText('Μαρία Δοκιμή').length).toBeGreaterThan(0)
  })
  it('reports a missing migration clearly and retries without silently substituting old data', async () => {
    backend.fail = true
    render(<Schedule />)
    expect((await screen.findByRole('alert')).textContent).toContain('workforce_read_model')
    expect(document.querySelector('[data-date]')).toBeNull()
    backend.fail = false; fireEvent.click(screen.getByText('Επανάληψη φόρτωσης'))
    await screen.findByText('Φορτώθηκε η επιλεγμένη περίοδος')
    expect(document.querySelector('[data-date="2026-11-05"]')).not.toBeNull()
  })
  it('returns to the existing requests window after dismissing a new request', async () => {
    render(<Schedule />); await screen.findByText('Φορτώθηκε η επιλεγμένη περίοδος')
    fireEvent.click(screen.getByRole('button', { name: 'Άδειες & ρεπό' }))
    const opener = screen.getByRole('button', { name: 'Νέα αίτηση' })
    opener.focus(); fireEvent.click(opener)
    fireEvent.change(screen.getByLabelText('Αιτιολογία (προαιρετικά)'), { target: { value: 'Προσωρινή καταχώριση' } })
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Απόρριψη αλλαγών' }))
    expect(screen.getByRole('dialog', { name: 'Άδειες & ρεπό' })).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Νέα αίτηση' }))
  })
  it('retains leave request values and reports save failure without closing or declaring success', async () => {
    backend.saveError = 'Δεν επιτρέπεται η καταχώριση'
    const onSaved = vi.fn()
    render(<LeaveRequestForm storeId="store" userId="one" initialDate="2026-11-05" onClose={vi.fn()} onSaved={onSaved} />)
    fireEvent.change(screen.getByLabelText('Αιτιολογία (προαιρετικά)'), { target: { value: 'Η αιτιολογία μου' } })
    fireEvent.submit(screen.getByLabelText('Από').closest('form')!)
    expect((await screen.findByRole('alert')).textContent).toContain('Δεν επιτρέπεται')
    expect((screen.getByLabelText('Αιτιολογία (προαιρετικά)') as HTMLTextAreaElement).value).toBe('Η αιτιολογία μου')
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(onSaved).not.toHaveBeenCalled()
  })
})
