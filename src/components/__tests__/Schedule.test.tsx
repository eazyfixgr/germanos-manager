// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Schedule from '../../pages/Schedule'
import { LeaveRequestForm, LeaveRequests } from '../schedule/LeaveRequests'
import type { ScheduleData } from '../../lib/schedule/model'

const backend = vi.hoisted(() => ({
  calls: [] as Record<string, string>[], fail: false, deferOwn: false,
  resolveOwn: null as null | ((value: unknown) => void), saveError: null as string | null,
  saveDayError: null as string | null, savedDays: [] as unknown[], rpcCalls: [] as { name: string; args: Record<string, unknown> }[], reviewError: null as string | null, revokeError: null as string | null,
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
  rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
    backend.rpcCalls.push({ name, args })
    if (name === 'submit_leave_request') return { data: null, error: backend.saveError ? { message: backend.saveError } : null }
    if (name === 'review_leave_request') return { data: null, error: backend.reviewError ? { message: backend.reviewError } : null }
    if (name === 'revoke_leave_request') return { data: null, error: backend.revokeError ? { message: backend.revokeError } : null }
    if (name === 'save_schedule_day') {
      backend.savedDays.push(args.p_assignments)
      return { data: null, error: backend.saveDayError ? { message: backend.saveDayError } : null }
    }
    if (name !== 'read_schedule') return { data: null, error: null }
    backend.calls.push(args as Record<string,string>)
    if (backend.fail) return { data: null, error: { code: 'PGRST202' } }
    if (args.p_scope === 'own' && backend.deferOwn) return new Promise((resolve) => { backend.resolveOwn = resolve })
    return { data: payload(args as Record<string, string>), error: null }
  }),
  from: vi.fn(() => ({ insert: () => ({ select: () => ({ single: async () => ({ data: null, error: backend.saveError ? { message: backend.saveError } : null }) }) }) })),
} }))

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-05T12:00:00Z'))
  backend.calls = []; backend.fail = false; backend.deferOwn = false; backend.resolveOwn = null; backend.saveError = null
  backend.saveDayError = null; backend.savedDays = []
  backend.rpcCalls = []; backend.reviewError = null; backend.revokeError = null
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
    render(<LeaveRequestForm data={payload({ p_store: 'store', p_start: '2026-11-05', p_end: '2026-12-01', p_scope: 'team' })} initialDate="2026-11-05" onClose={vi.fn()} onSaved={onSaved} />)
    fireEvent.change(screen.getByLabelText('Αιτιολογία (προαιρετικά)'), { target: { value: 'Η αιτιολογία μου' } })
    fireEvent.submit(screen.getByLabelText('Από').closest('form')!)
    expect((await screen.findByRole('alert')).textContent).toContain('Δεν επιτρέπεται')
    expect((screen.getByLabelText('Αιτιολογία (προαιρετικά)') as HTMLTextAreaElement).value).toBe('Η αιτιολογία μου')
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(onSaved).not.toHaveBeenCalled()
  })
  it('previews chargeable leave dates, allows rest preferences and submits only through the RPC', async () => {
    const data = payload({ p_store: 'store', p_start: '2026-11-01', p_end: '2026-12-01', p_scope: 'team' })
    const saved = vi.fn()
    render(<LeaveRequestForm data={data} initialDate="2026-11-05" onClose={vi.fn()} onSaved={saved} />)
    fireEvent.change(screen.getByLabelText('Είδος'), { target: { value: 'adeia' } })
    fireEvent.change(screen.getByLabelText('Έως'), { target: { value: '2026-11-07' } })
    expect(screen.getByText('2')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('06/11/2026'))
    fireEvent.click(screen.getByRole('button', { name: 'Υποβολή αίτησης' }))
    await waitFor(() => expect(saved).toHaveBeenCalledOnce())
    const call = backend.rpcCalls.find((entry) => entry.name === 'submit_leave_request')!
    expect(call.args).toMatchObject({ p_type: 'adeia', p_start: '2026-11-05', p_end: '2026-11-07', p_requested_rest_dates: ['2026-11-06'] })
  })
  it('reviews leave with explicit rest choices and revision through the transaction RPC', async () => {
    const data = payload({ p_store: 'store', p_start: '2026-11-01', p_end: '2026-12-01', p_scope: 'team' })
    data.leaves = [{ id: 'leave', store_id: 'store', user_id: 'one', type: 'adeia', start_date: '2026-11-05', end_date: '2026-11-07',
      reason: 'Synthetic leave', status: 'pending', reviewed_by: null, created_at: '', revision: 4, requested_rest_dates: [] }]
    const changed = vi.fn()
    render(<LeaveRequests data={data} range={{ start: '2026-11-01', end: '2026-12-01' }} actorId="manager" canManage canRequest={false} onClose={vi.fn()} onNew={vi.fn()} onChanged={changed} />)
    fireEvent.click(screen.getByRole('button', { name: 'Έγκριση / έλεγχος' }))
    const dialog = screen.getByRole('dialog', { name: 'Έλεγχος άδειας / ρεπό' })
    fireEvent.click(within(dialog).getByLabelText('06/11/2026'))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Έγκριση και εφαρμογή' }))
    await waitFor(() => expect(changed).toHaveBeenCalledOnce())
    expect(backend.rpcCalls.find((entry) => entry.name === 'review_leave_request')?.args).toMatchObject({
      p_store: 'store', p_request: 'leave', p_revision: 4, p_decision: 'approved', p_selected_rest_dates: ['2026-11-06'],
    })
  })
  it('keeps the review open on a transactional error and allows retry with selected rest dates', async () => {
    const data = payload({ p_store: 'store', p_start: '2026-11-01', p_end: '2026-12-01', p_scope: 'team' })
    data.leaves = [{ id: 'retry-leave', store_id: 'store', user_id: 'one', type: 'adeia', start_date: '2026-11-05', end_date: '2026-11-07',
      reason: 'Synthetic leave', status: 'pending', reviewed_by: null, created_at: '', revision: 3, requested_rest_dates: [] }]
    const changed = vi.fn(); backend.reviewError = 'Overlap conflict'
    render(<LeaveRequests data={data} range={{ start: '2026-11-01', end: '2026-12-01' }} actorId="manager" canManage canRequest={false} onClose={vi.fn()} onNew={vi.fn()} onChanged={changed} />)
    fireEvent.click(screen.getByRole('button', { name: 'Έγκριση / έλεγχος' }))
    const approval = screen.getByRole('dialog', { name: 'Έλεγχος άδειας / ρεπό' })
    fireEvent.click(within(approval).getByLabelText('06/11/2026'))
    fireEvent.click(within(approval).getByRole('button', { name: 'Έγκριση και εφαρμογή' }))
    expect((await within(approval).findByRole('alert')).textContent).toContain('Overlap conflict')
    expect(within(approval).getByLabelText('06/11/2026')).toBeTruthy()
    backend.reviewError = null
    fireEvent.click(within(approval).getByRole('button', { name: 'Έγκριση και εφαρμογή' }))
    await waitFor(() => expect(changed).toHaveBeenCalledOnce())
  })
  it('cancels a pending request through the revision-checked RPC', async () => {
    const data = payload({ p_store: 'store', p_start: '2026-11-01', p_end: '2026-12-01', p_scope: 'own' })
    data.leaves = [{ id: 'pending-own', store_id: 'store', user_id: 'one', type: 'repo', start_date: '2026-11-05', end_date: '2026-11-05',
      reason: null, status: 'pending', reviewed_by: null, created_at: '', revision: 2 }]
    const changed = vi.fn()
    render(<LeaveRequests data={data} range={{ start: '2026-11-01', end: '2026-12-01' }} actorId="one" canManage={false} canRequest onClose={vi.fn()} onNew={vi.fn()} onChanged={changed} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ακύρωση αίτησης' }))
    await waitFor(() => expect(changed).toHaveBeenCalledOnce())
    expect(backend.rpcCalls.find((call) => call.name === 'revoke_leave_request')?.args)
      .toMatchObject({ p_store: 'store', p_request: 'pending-own', p_revision: 2 })
  })
  it('collects real split edits as a day draft and saves the batch once without losing it on failure', async () => {
    render(<Schedule />); await screen.findByText('Φορτώθηκε η επιλεγμένη περίοδος')
    const dayButton = document.querySelector<HTMLButtonElement>('[data-date="2026-11-05"]')!
    fireEvent.click(dayButton)
    const day = screen.getByRole('dialog', { name: 'Πρόγραμμα ημέρας' })
    fireEvent.click(within(day).getAllByRole('button', { name: 'Αλλαγή βάρδιας' })[0])
    const editor = screen.getByRole('dialog', { name: 'Χειροκίνητη βάρδια' })
    fireEvent.change(within(editor).getByLabelText('Τύπος βάρδιας'), { target: { value: 'split' } })
    fireEvent.change(within(editor).getByLabelText('Έναρξη 1'), { target: { value: '09:00' } })
    fireEvent.change(within(editor).getByLabelText('Λήξη 1'), { target: { value: '11:00' } })
    fireEvent.change(within(editor).getByLabelText('Έναρξη 2'), { target: { value: '13:00' } })
    fireEvent.change(within(editor).getByLabelText('Λήξη 2'), { target: { value: '15:00' } })
    fireEvent.click(within(editor).getByRole('button', { name: 'Αποθήκευση βάρδιας' }))
    expect(await screen.findByRole('button', { name: 'Αποθήκευση 1 αλλαγών' })).toBeTruthy()
    backend.saveDayError = 'Revision conflict'
    fireEvent.click(screen.getByRole('button', { name: 'Αποθήκευση 1 αλλαγών' }))
    expect((await within(day).findByRole('alert')).textContent).toContain('Revision conflict')
    expect(screen.getByRole('button', { name: 'Αποθήκευση 1 αλλαγών' })).toBeTruthy()
    backend.saveDayError = null
    fireEvent.click(screen.getByRole('button', { name: 'Αποθήκευση 1 αλλαγών' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Πρόγραμμα ημέρας' })).toBeNull())
    const rows = backend.savedDays.at(-1)
    expect(rows).toEqual([expect.objectContaining({ shift_type: 'split', segments: [
      { start: '09:00', end: '11:00' }, { start: '13:00', end: '15:00' },
    ] })])
  })
})
