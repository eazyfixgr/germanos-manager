import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { currentMonth, fmtDate, monthLabel, SHIFT_TYPE } from '../lib/constants'
import { buildSchedule } from '../lib/scheduleGen'
import { logActivity } from '../lib/activity'
import type { LeaveRequest, Profile, Shift, StoreCalendarDay, StorePattern } from '../lib/types'
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, Textarea } from '../components/ui'
import PatternSettings from '../components/schedule/PatternSettings'

type Tab = 'week' | 'requests'

function pad(n: number) { return String(n).padStart(2, '0') }
function nextMonthStr(month: string) {
  const [y, m] = month.split('-').map(Number)
  return m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`
}

export default function Schedule() {
  const { profile, store, isAdmin, refreshProfile } = useAuth()
  const [tab, setTab] = useState<Tab>('week')
  const [shifts, setShifts] = useState<Shift[]>([])
  const [employees, setEmployees] = useState<Profile[]>([])
  const [leaves, setLeaves] = useState<LeaveRequest[]>([])
  const [patterns, setPatterns] = useState<StorePattern[]>([])
  const [loading, setLoading] = useState(true)
  const [showReq, setShowReq] = useState(false)
  const [patternOpen, setPatternOpen] = useState(false)
  const [weekOffset, setWeekOffset] = useState(0)
  const [genMonth, setGenMonth] = useState(currentMonth())
  const [req, setReq] = useState({ type: 'repo' as 'repo' | 'adeia', start: '', end: '', reason: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')

  async function load() {
    if (!store) { setLoading(false); return }
    const [sh, em, lv, pat] = await Promise.all([
      supabase.from('shifts').select('*').eq('store_id', store.id),
      supabase.from('profiles').select('*').eq('store_id', store.id).eq('active', true).is('deleted_at', null),
      supabase.from('leave_requests').select('*').eq('store_id', store.id).order('created_at', { ascending: false }),
      supabase.from('store_patterns').select('*').eq('store_id', store.id),
    ])
    setShifts((sh.data as Shift[]) ?? [])
    setEmployees((em.data as Profile[]) ?? [])
    setLeaves((lv.data as LeaveRequest[]) ?? [])
    setPatterns((pat.data as StorePattern[]) ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [store])

  const week = useMemo(() => {
    const base = new Date()
    base.setDate(base.getDate() + weekOffset * 7)
    const day = base.getDay()
    const mondayOffset = day === 0 ? -6 : 1 - day
    const monday = new Date(base)
    monday.setDate(base.getDate() + mondayOffset)
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday)
      d.setDate(monday.getDate() + i)
      return d.toISOString().slice(0, 10)
    })
  }, [weekOffset])

  async function setShift(empId: string, date: string, shiftType: string, start: string | null, end: string | null) {
    if (!store) return
    const existing = shifts.find((s) => s.user_id === empId && s.date === date)
    if (existing) {
      await supabase.from('shifts').update({ shift_type: shiftType, start_time: start, end_time: end }).eq('id', existing.id)
    } else {
      await supabase.from('shifts').insert({ store_id: store.id, user_id: empId, date, shift_type: shiftType, start_time: start, end_time: end })
    }
    await load()
  }

  async function generate() {
    if (!store || !profile) return
    if (!window.confirm(`Δημιουργία αυτόματου προγράμματος για ${monthLabel(genMonth)}; Θα αντικατασταθούν οι υπάρχουσες βάρδιες του μήνα.`)) return
    setBusy(true); setError(''); setInfo('')
    const [patRes, calRes, lvRes, empRes] = await Promise.all([
      supabase.from('store_patterns').select('*').eq('store_id', store.id),
      supabase.from('store_calendar').select('*').eq('store_id', store.id)
        .gte('date', `${genMonth}-01`).lt('date', nextMonthStr(genMonth)),
      supabase.from('leave_requests').select('*').eq('store_id', store.id),
      supabase.from('profiles').select('*').eq('store_id', store.id).eq('active', true).is('deleted_at', null),
    ])
    if (patRes.error || calRes.error || lvRes.error || empRes.error) {
      setBusy(false); setError('Σφάλμα φόρτωσης δεδομένων.'); return
    }

    const result = buildSchedule({
      storeId: store.id,
      month: genMonth,
      employees: (empRes.data as Profile[]).map((e) => ({ id: e.id, full_name: e.full_name })),
      patterns: (patRes.data as StorePattern[]).map((p) => ({
        weekday: p.weekday, closed: p.closed, level: p.level, start_time: p.start_time, end_time: p.end_time,
      })),
      calendar: (calRes.data as StoreCalendarDay[]).map((c) => ({
        date: c.date, is_working: c.is_working, open_time: c.open_time, close_time: c.close_time,
      })),
      leaves: (lvRes.data as LeaveRequest[]).map((l) => ({
        user_id: l.user_id, type: l.type, start_date: l.start_date, end_date: l.end_date, status: l.status,
      })),
      minStaff: store.min_staff ?? 1,
    })

    const del = await supabase.from('shifts').delete().eq('store_id', store.id)
      .gte('date', `${genMonth}-01`).lt('date', nextMonthStr(genMonth))
    if (del.error) { setBusy(false); setError(del.error.message); return }

    let inserted = 0
    for (let i = 0; i < result.shifts.length; i += 300) {
      const chunk = result.shifts.slice(i, i + 300)
      const { error } = await supabase.from('shifts').insert(chunk)
      if (error) { setError(error.message); break }
      inserted += chunk.length
    }
    await logActivity('Αυτόματο πρόγραμμα', `${monthLabel(genMonth)}: ${inserted} βάρδιες`)
    setBusy(false)
    setInfo(`Δημιουργήθηκαν ${inserted} βάρδιες.` + (result.warnings.length ? ` Προειδοποιήσεις: ${result.warnings.join(' · ')}` : ''))
    await load()
  }

  async function submitRequest(e: React.FormEvent) {
    e.preventDefault()
    if (!store || !profile) return
    if (!req.start || !req.end) return
    setBusy(true)
    await supabase.from('leave_requests').insert({
      store_id: store.id, user_id: profile.id, type: req.type,
      start_date: req.start, end_date: req.end, reason: req.reason || null,
      status: 'pending',
    })
    await logActivity('Αίτηση ρεπό/άδειας', `${req.type === 'repo' ? 'Ρεπό' : 'Άδεια'} ${req.start} → ${req.end}`)
    setBusy(false)
    setShowReq(false)
    setReq({ type: 'repo', start: '', end: '', reason: '' })
    await load()
  }

  async function reviewLeave(id: string, status: 'approved' | 'rejected') {
    await supabase.from('leave_requests').update({ status, reviewed_by: profile?.id }).eq('id', id)
    await logActivity('Έγκριση/Απόρριψη αιτήματος', `${status}`)
    await load()
  }

  if (loading) return <Spinner />

  if (!store) {
    return (
      <div className="space-y-4">
        <PageHeader eyebrow="Ομάδα" title="Πρόγραμμα" subtitle="Βάρδιες, ρεπό και άδειες προσωπικού" />
        <Card><EmptyState title="Δεν έχει επιλεγεί κατάστημα" text="Επιλέξτε κατάστημα από πάνω ή δημιουργήστε νέο από «Καταστήματα»." /></Card>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Ομάδα"
        title="Πρόγραμμα"
        subtitle="Βάρδιες, ρεπό και άδειες προσωπικού"
        actions={
          <>
            <Button onClick={() => setShowReq(true)}>Αίτηση ρεπό/άδειας</Button>
            {isAdmin && <Button variant="secondary" onClick={() => setPatternOpen(true)}>Ωράριο/Μοτίβα</Button>}
            {isAdmin && (
              <Field label="Μήνας προγράμματος">
                <input type="month" value={genMonth} onChange={(e) => setGenMonth(e.target.value)}
                  className="h-10 rounded-control border border-line bg-surface px-3 text-sm" />
              </Field>
            )}
            {isAdmin && <Button onClick={generate} disabled={busy}>{busy ? 'Δημιουργία…' : 'Αυτόματο πρόγραμμα'}</Button>}
          </>
        }
      />

      {error && <div className="rounded-control border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {info && <div className="rounded-control border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">{info}</div>}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button variant="secondary" className="!px-2 !py-1 text-xs" onClick={() => setWeekOffset((w) => w - 1)}>‹</Button>
          <span className="text-sm font-semibold text-ink">{fmtDate(week[0])} – {fmtDate(week[6])}</span>
          <Button variant="secondary" className="!px-2 !py-1 text-xs" onClick={() => setWeekOffset((w) => w + 1)}>›</Button>
          <Button variant="secondary" className="!px-2 !py-1 text-xs" onClick={() => setWeekOffset(0)}>Σήμερα</Button>
        </div>
        <div className="flex rounded-control border border-line bg-slate-100 p-1">
          <button className={`rounded-md px-4 py-1.5 text-sm font-medium ${tab === 'week' ? 'bg-surface shadow-sm text-ink' : 'text-slate-600'}`} onClick={() => setTab('week')}>
            Εβδομάδα
          </button>
          <button className={`rounded-md px-4 py-1.5 text-sm font-medium ${tab === 'requests' ? 'bg-surface shadow-sm text-ink' : 'text-slate-600'}`} onClick={() => setTab('requests')}>
            Αιτήσεις ({leaves.filter((l) => l.status === 'pending').length})
          </button>
        </div>
      </div>

      {tab === 'week' ? (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line">
                  <th className="py-2 pr-2 text-left text-xs uppercase text-muted">Υπάλληλος</th>
                  {week.map((d) => (
                    <th key={d} className="px-1 py-2 text-center text-xs font-medium text-muted">
                      {fmtDate(d)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {employees.map((e) => (
                  <tr key={e.id}>
                    <td className="py-2 pr-2 font-medium text-ink">{e.full_name}</td>
                    {week.map((d) => {
                      const shift = shifts.find((s) => s.user_id === e.id && s.date === d)
                      return (
                        <td key={d} className="px-1 py-2 align-top">
                          {isAdmin ? (
                            <div>
                              <select
                                value={shift?.shift_type ?? 'custom'}
                                onChange={(ev) => setShift(e.id, d, ev.target.value, null, null)}
                                className="w-full rounded-md border border-line bg-surface px-1 py-1 text-xs"
                              >
                                {Object.entries(SHIFT_TYPE).map(([k, v]) => (
                                  <option key={k} value={k}>{v.label}</option>
                                ))}
                              </select>
                              {shift?.start_time && shift?.end_time && (
                                <div className="mt-1 text-[10px] text-slate-500">{shift.start_time}–{shift.end_time}</div>
                              )}
                            </div>
                          ) : (
                            <div>
                              <Badge className={SHIFT_TYPE[shift?.shift_type ?? 'custom'].color}>
                                {SHIFT_TYPE[shift?.shift_type ?? 'custom'].label}
                              </Badge>
                              {shift?.start_time && shift?.end_time && (
                                <div className="mt-1 text-[10px] text-slate-500">{shift.start_time}–{shift.end_time}</div>
                              )}
                            </div>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!isAdmin && <p className="mt-3 text-xs text-slate-400">Το πρόγραμμα το επεξεργάζεται μόνο ο admin.</p>}
        </Card>
      ) : (
        <div className="space-y-2">
          {leaves.length === 0 && <Card><EmptyState title="Δεν υπάρχουν αιτήσεις" text="Οι αιτήσεις ρεπό/άδειας θα εμφανίζονται εδώ." /></Card>}
          {leaves.map((l) => {
            const emp = employees.find((e) => e.id === l.user_id)
            return (
              <Card key={l.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-medium text-ink">
                      {emp?.full_name ?? 'Άγνωστος'} — {l.type === 'repo' ? 'Ρεπό' : 'Άδεια'}
                    </div>
                    <div className="text-xs text-slate-500">
                      {fmtDate(l.start_date)} → {fmtDate(l.end_date)}
                      {l.reason && ` · ${l.reason}`}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className={
                      l.status === 'approved' ? 'bg-green-100 text-green-800'
                      : l.status === 'rejected' ? 'bg-red-100 text-red-800'
                      : 'bg-amber-100 text-amber-800'
                    }>
                      {l.status === 'approved' ? 'Εγκρίθηκε' : l.status === 'rejected' ? 'Απορρίφθηκε' : 'Σε αναμονή'}
                    </Badge>
                    {isAdmin && l.status === 'pending' && (
                      <>
                        <Button variant="secondary" className="!py-1 !px-2 text-xs" onClick={() => reviewLeave(l.id, 'approved')}>Έγκριση</Button>
                        <Button variant="danger" className="!py-1 !px-2 text-xs" onClick={() => reviewLeave(l.id, 'rejected')}>Απόρριψη</Button>
                      </>
                    )}
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      <Modal open={showReq} onClose={() => setShowReq(false)} title="Αίτηση ρεπό / άδειας">
        <form onSubmit={submitRequest} className="space-y-3">
          <Field label="Τύπος">
            <Select value={req.type} onChange={(e) => setReq({ ...req, type: e.target.value as 'repo' | 'adeia' })}>
              <option value="repo">Ρεπό</option>
              <option value="adeia">Άδεια</option>
            </Select>
          </Field>
          <Field label="Από">
            <Input type="date" required value={req.start} onChange={(e) => setReq({ ...req, start: e.target.value })} />
          </Field>
          <Field label="Έως">
            <Input type="date" required value={req.end} onChange={(e) => setReq({ ...req, end: e.target.value })} />
          </Field>
          <Field label="Αιτιολογία">
            <Textarea value={req.reason} onChange={(e) => setReq({ ...req, reason: e.target.value })} rows={2} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setShowReq(false)}>Άκυρο</Button>
            <Button type="submit" disabled={busy}>{busy ? 'Υποβολή…' : 'Υποβολή'}</Button>
          </div>
        </form>
      </Modal>

      <PatternSettings
        open={patternOpen}
        onClose={() => setPatternOpen(false)}
        storeId={store?.id ?? ''}
        patterns={patterns}
        minStaff={store?.min_staff ?? 1}
        onSaved={async () => { await refreshProfile(); await load() }}
      />
    </div>
  )
}
