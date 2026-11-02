import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { currentMonth, fmtNum, monthLabel } from '../lib/constants'
import { computeProjection } from '../lib/projection'
import { downloadCsv } from '../lib/csv'
import { logActivity } from '../lib/activity'
import type { EmployeeTarget, Profile, StoreTarget } from '../lib/types'
import { Button, Card, Field, Input, Modal, Spinner } from '../components/ui'

interface PointRow { id: string; user_id: string; date: string; points: number }
interface ShiftRow { user_id: string; date: string; shift_type: string }

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function Targets() {
  const { profile, store, isAdmin } = useAuth()
  const [month, setMonth] = useState(currentMonth())
  const [storeTarget, setStoreTarget] = useState<StoreTarget | null>(null)
  const [empTargets, setEmpTargets] = useState<EmployeeTarget[]>([])
  const [employees, setEmployees] = useState<Profile[]>([])
  const [entries, setEntries] = useState<PointRow[]>([])
  const [shifts, setShifts] = useState<ShiftRow[]>([])
  const [storePoints, setStorePoints] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [pointsFor, setPointsFor] = useState<Profile | null>(null)
  const [entryDate, setEntryDate] = useState(todayStr())
  const [entryPoints, setEntryPoints] = useState('')
  const [entryBusy, setEntryBusy] = useState(false)

  const canEdit = isAdmin || profile?.can_edit_points === true

  const [start, next] = useMemo(() => {
    const [y, m] = month.split('-').map(Number)
    const s = `${month}-01`
    const n = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
    return [s, n]
  }, [month])

  async function load() {
    if (!store) { setLoading(false); return }
    setLoading(true)
    setError('')
    const [st, et, em, pe, sh] = await Promise.all([
      supabase.from('store_targets').select('*').eq('store_id', store.id).eq('month', month).maybeSingle(),
      supabase.from('employee_targets').select('*').eq('store_id', store.id).eq('month', month),
      supabase.from('profiles').select('*').eq('store_id', store.id).eq('active', true).is('deleted_at', null),
      supabase.from('point_entries').select('*').eq('store_id', store.id).gte('date', start).lt('date', next),
      supabase.from('shifts').select('user_id, date, shift_type').eq('store_id', store.id).gte('date', start).lt('date', next),
    ])
    setStoreTarget(st.data as StoreTarget | null)
    setEmpTargets((et.data as EmployeeTarget[]) ?? [])
    setEmployees((em.data as Profile[]) ?? [])
    setEntries((pe.data as PointRow[]) ?? [])
    setShifts((sh.data as ShiftRow[]) ?? [])
    setStorePoints(String(st.data?.store_points ?? ''))
    setLoading(false)
  }

  useEffect(() => { load() }, [store, month])

  const projFor = (userId: string) => {
    const userEntries = entries.filter((e) => e.user_id === userId).map((e) => ({ date: e.date, points: Number(e.points) }))
    const userShifts = shifts.filter((s) => s.user_id === userId).map((s) => ({ date: s.date, shift_type: s.shift_type }))
    return computeProjection(userEntries, userShifts, month)
  }

  const totals = useMemo(() => {
    let target = 0, earned = 0, projection = 0
    for (const e of employees) {
      target += Number(empTargets.find((t) => t.user_id === e.id)?.points ?? 0)
      const p = projFor(e.id)
      earned += p.total
      projection += p.projection
    }
    return { target, earned, projection }
  }, [employees, empTargets, entries, shifts, month])

  async function saveStoreTarget() {
    if (!store) return
    setSaving(true)
    const pts = Number(storePoints) || 0
    if (storeTarget) {
      await supabase.from('store_targets').update({ store_points: pts }).eq('id', storeTarget.id)
    } else {
      await supabase.from('store_targets').insert({ store_id: store.id, month, store_points: pts })
    }
    await logActivity('Ενημέρωση στόχου καταστήματος', `${monthLabel(month)}: ${pts} πόντοι`)
    setSaving(false)
    await load()
  }

  async function saveEmpTarget(empId: string, value: string) {
    if (!store) return
    const num = Number(value) || 0
    const existing = empTargets.find((t) => t.user_id === empId)
    if (existing) {
      await supabase.from('employee_targets').update({ points: num }).eq('id', existing.id)
    } else {
      await supabase.from('employee_targets').insert({ store_id: store.id, user_id: empId, month, points: num, projection: 0 })
    }
    await logActivity('Ενημέρωση στόχου υπαλλήλου', `${num}`)
    await load()
  }

  function canRecord(userId: string) {
    return isAdmin || profile?.can_edit_points === true || userId === profile?.id
  }

  function openPoints(p: Profile) {
    setPointsFor(p)
    setEntryDate(todayStr())
    setEntryPoints('')
    setError('')
  }

  async function saveEntry(e: React.FormEvent) {
    e.preventDefault()
    if (!store || !profile || !pointsFor) return
    if (!entryDate) { setError('Επιλέξτε ημερομηνία.'); return }
    setEntryBusy(true)
    const { error } = await supabase.from('point_entries').upsert(
      {
        store_id: store.id,
        user_id: pointsFor.id,
        date: entryDate,
        points: Number(entryPoints) || 0,
        created_by: profile.id,
      },
      { onConflict: 'store_id,user_id,date' },
    )
    setEntryBusy(false)
    if (error) { setError(error.message); return }
    setEntryPoints('')
    await load()
  }

  async function deleteEntry(id: string) {
    const { error } = await supabase.from('point_entries').delete().eq('id', id)
    if (error) { setError(error.message); return }
    await load()
  }

  function exportCsv() {
    const rows = employees.map((e) => {
      const t = empTargets.find((x) => x.user_id === e.id)
      const p = projFor(e.id)
      return [e.full_name, e.email, t?.points ?? 0, p.total, p.projection, `${p.elapsed}/${p.totalWorking}`]
    })
    downloadCsv(
      `stoxoi-${month}.csv`,
      ['Υπάλληλος', 'Email', 'Στόχος', 'Πόντοι μήνα', 'Projection', 'Εργάσιμες'],
      rows,
    )
  }

  const forEntries = pointsFor ? entries.filter((e) => e.user_id === pointsFor.id).sort((a, b) => (a.date < b.date ? 1 : -1)) : []

  if (loading) return <Spinner />

  if (!store) {
    return <Card><p className="text-sm text-slate-500">Δεν έχει επιλεγεί κατάστημα. Επιλέξτε κατάστημα από πάνω.</p></Card>
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-slate-900">Στόχοι</h1>
        <div className="flex items-end gap-2">
          <Field label="Μήνας">
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </Field>
          <Button variant="secondary" onClick={exportCsv}>Εξαγωγή CSV</Button>
        </div>
      </div>
      <p className="text-sm text-slate-500">{monthLabel(month)}</p>

      <Card>
        <h2 className="font-semibold text-slate-900">Στόχος καταστήματος (πόντοι)</h2>
        <div className="mt-3 flex items-end gap-3">
          <div className="flex-1">
            <Input
              type="number"
              value={storePoints}
              onChange={(e) => setStorePoints(e.target.value)}
              disabled={!canEdit}
              placeholder="Πόντοι στόχου"
            />
          </div>
          {canEdit && (
            <Button onClick={saveStoreTarget} disabled={saving}>
              {saving ? 'Αποθήκευση…' : 'Αποθήκευση'}
            </Button>
          )}
        </div>
        {!canEdit && <p className="mt-2 text-xs text-slate-400">Μόνο ο admin μπορεί να αλλάξει τον στόχο.</p>}
      </Card>

      <Card>
        <h2 className="font-semibold text-slate-900">Στόχοι &amp; πρόοδος υπαλλήλων</h2>
        <p className="mt-1 text-xs text-slate-500">
          Το Projection υπολογίζεται αυτόματα: πόντοι μήνα ÷ εργάσιμες που πέρασαν × σύνολο εργάσιμων.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                <th className="py-2 pr-2">Υπάλληλος</th>
                <th className="py-2 pr-2 text-right">Στόχος</th>
                <th className="py-2 pr-2 text-right">Πόντοι μήνα</th>
                <th className="py-2 pr-2 text-right">Projection</th>
                <th className="py-2 pr-2 text-center">Εργάσιμες</th>
                <th className="py-2 text-right">Πόντοι</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {employees.map((e) => {
                const t = empTargets.find((x) => x.user_id === e.id)
                const p = projFor(e.id)
                return (
                  <tr key={e.id}>
                    <td className="py-2 pr-2 font-medium text-slate-800">{e.full_name}</td>
                    <td className="py-2 pr-2">
                      {canEdit ? (
                        <input
                          type="number"
                          defaultValue={t?.points ?? 0}
                          key={`${e.id}-${t?.points ?? 0}`}
                          onBlur={(ev) => saveEmpTarget(e.id, ev.target.value)}
                          className="w-24 rounded-lg border border-slate-300 px-2 py-1 text-right text-sm"
                        />
                      ) : (
                        <div className="text-right font-medium">{fmtNum(t?.points ?? 0)}</div>
                      )}
                    </td>
                    <td className="py-2 pr-2 text-right font-medium text-slate-900">{fmtNum(p.total)}</td>
                    <td className="py-2 pr-2 text-right font-semibold text-slate-900">{fmtNum(p.projection)}</td>
                    <td className="py-2 pr-2 text-center text-xs text-slate-500">{p.elapsed}/{p.totalWorking}</td>
                    <td className="py-2 text-right">
                      {canRecord(e.id) ? (
                        <Button variant="secondary" className="!px-2 !py-1 text-xs" onClick={() => openPoints(e)}>
                          Καταχώρηση
                        </Button>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
              {employees.length === 0 && (
                <tr><td colSpan={6} className="py-3 text-center text-slate-400">Δεν υπάρχουν υπάλληλοι.</td></tr>
              )}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-200 font-semibold text-slate-900">
                <td className="py-2 pr-2">Σύνολο</td>
                <td className="py-2 pr-2 text-right">{fmtNum(totals.target)}</td>
                <td className="py-2 pr-2 text-right">{fmtNum(totals.earned)}</td>
                <td className="py-2 pr-2 text-right">{fmtNum(totals.projection)}</td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      <Modal open={!!pointsFor} onClose={() => setPointsFor(null)} title={`Πόντοι — ${pointsFor?.full_name ?? ''}`}>
        <form onSubmit={saveEntry} className="space-y-3">
          {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          <div className="grid grid-cols-2 gap-2">
            <Field label="Ημερομηνία">
              <Input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
            </Field>
            <Field label="Πόντοι">
              <Input type="number" value={entryPoints} onChange={(e) => setEntryPoints(e.target.value)} placeholder="0" />
            </Field>
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={entryBusy}>{entryBusy ? 'Αποθήκευση…' : 'Αποθήκευση ημέρας'}</Button>
          </div>
        </form>

        <div className="mt-4">
          <div className="mb-1 text-xs font-medium uppercase text-slate-500">Καταχωρήσεις μήνα</div>
          {forEntries.length === 0 ? (
            <p className="text-sm text-slate-500">Δεν υπάρχουν καταχωρήσεις.</p>
          ) : (
            <ul className="max-h-56 divide-y divide-slate-100 overflow-y-auto">
              {forEntries.map((ent) => (
                <li key={ent.id} className="flex items-center justify-between py-1.5 text-sm">
                  <span className="text-slate-700">{ent.date}</span>
                  <span className="font-medium text-slate-900">{fmtNum(Number(ent.points))}</span>
                  <button
                    type="button"
                    className="text-xs font-medium text-red-600 hover:underline"
                    onClick={() => deleteEntry(ent.id)}
                  >
                    Διαγραφή
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Modal>
    </div>
  )
}
