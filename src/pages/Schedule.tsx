import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { fmtDate, SHIFT_TYPE } from '../lib/constants'
import { logActivity } from '../lib/activity'
import type { LeaveRequest, Profile, Shift } from '../lib/types'
import { Badge, Button, Card, Field, Input, Modal, Select, Spinner, Textarea } from '../components/ui'

type Tab = 'week' | 'requests'

export default function Schedule() {
  const { profile, store, isAdmin } = useAuth()
  const [tab, setTab] = useState<Tab>('week')
  const [shifts, setShifts] = useState<Shift[]>([])
  const [employees, setEmployees] = useState<Profile[]>([])
  const [leaves, setLeaves] = useState<LeaveRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [showReq, setShowReq] = useState(false)
  const [req, setReq] = useState({ type: 'repo' as 'repo' | 'adeia', start: '', end: '', reason: '' })
  const [busy, setBusy] = useState(false)

  async function load() {
    if (!store) return
    const [sh, em, lv] = await Promise.all([
      supabase.from('shifts').select('*').eq('store_id', store.id),
      supabase.from('profiles').select('*').eq('store_id', store.id).eq('active', true),
      supabase.from('leave_requests').select('*').eq('store_id', store.id).order('created_at', { ascending: false }),
    ])
    setShifts((sh.data as Shift[]) ?? [])
    setEmployees((em.data as Profile[]) ?? [])
    setLeaves((lv.data as LeaveRequest[]) ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [store])

  const week = useMemo(() => {
    const today = new Date()
    const day = today.getDay()
    const mondayOffset = day === 0 ? -6 : 1 - day
    const monday = new Date(today)
    monday.setDate(today.getDate() + mondayOffset)
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday)
      d.setDate(monday.getDate() + i)
      return d.toISOString().slice(0, 10)
    })
  }, [])

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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-900">Πρόγραμμα</h1>
        <Button onClick={() => setShowReq(true)}>+ Αίτηση ρεπό/άδειας</Button>
      </div>

      <div className="flex rounded-lg bg-slate-200 p-1">
        <button className={`flex-1 rounded-md py-2 text-sm font-medium ${tab === 'week' ? 'bg-white shadow' : 'text-slate-600'}`} onClick={() => setTab('week')}>
          Εβδομάδα
        </button>
        <button className={`flex-1 rounded-md py-2 text-sm font-medium ${tab === 'requests' ? 'bg-white shadow' : 'text-slate-600'}`} onClick={() => setTab('requests')}>
          Αιτήσεις ({leaves.filter((l) => l.status === 'pending').length})
        </button>
      </div>

      {tab === 'week' ? (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="py-2 pr-2 text-left text-xs uppercase text-slate-500">Υπάλληλος</th>
                  {week.map((d) => (
                    <th key={d} className="px-1 py-2 text-center text-xs font-medium text-slate-500">
                      {fmtDate(d)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {employees.map((e) => (
                  <tr key={e.id}>
                    <td className="py-2 pr-2 font-medium text-slate-800">{e.full_name}</td>
                    {week.map((d) => {
                      const shift = shifts.find((s) => s.user_id === e.id && s.date === d)
                      return (
                        <td key={d} className="px-1 py-2">
                          {isAdmin ? (
                            <select
                              value={shift?.shift_type ?? 'custom'}
                              onChange={(ev) => setShift(e.id, d, ev.target.value, null, null)}
                              className="w-full rounded border border-slate-200 bg-white px-1 py-1 text-xs"
                            >
                              {Object.entries(SHIFT_TYPE).map(([k, v]) => (
                                <option key={k} value={k}>{v.label}</option>
                              ))}
                            </select>
                          ) : (
                            <Badge className={SHIFT_TYPE[shift?.shift_type ?? 'custom'].color}>
                              {SHIFT_TYPE[shift?.shift_type ?? 'custom'].label}
                            </Badge>
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
          {leaves.length === 0 && <Card><p className="text-sm text-slate-500">Δεν υπάρχουν αιτήσεις.</p></Card>}
          {leaves.map((l) => {
            const emp = employees.find((e) => e.id === l.user_id)
            return (
              <Card key={l.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-medium text-slate-900">
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
    </div>
  )
}
