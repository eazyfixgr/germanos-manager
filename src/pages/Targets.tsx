import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { currentMonth, fmtNum, monthLabel } from '../lib/constants'
import { downloadCsv } from '../lib/csv'
import { logActivity } from '../lib/activity'
import type { EmployeeTarget, Profile, StoreTarget } from '../lib/types'
import { Button, Card, Field, Input, Spinner } from '../components/ui'

export default function Targets() {
  const { profile, store, isAdmin } = useAuth()
  const [month, setMonth] = useState(currentMonth())
  const [storeTarget, setStoreTarget] = useState<StoreTarget | null>(null)
  const [empTargets, setEmpTargets] = useState<EmployeeTarget[]>([])
  const [employees, setEmployees] = useState<Profile[]>([])
  const [storePoints, setStorePoints] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const canEdit = isAdmin || profile?.can_edit_points === true

  async function load() {
    if (!store) { setLoading(false); return }
    setLoading(true)
    const [st, et, em] = await Promise.all([
      supabase.from('store_targets').select('*').eq('store_id', store.id).eq('month', month).maybeSingle(),
      supabase.from('employee_targets').select('*').eq('store_id', store.id).eq('month', month),
      supabase.from('profiles').select('*').eq('store_id', store.id).eq('active', true),
    ])
    setStoreTarget(st.data as StoreTarget | null)
    setEmpTargets((et.data as EmployeeTarget[]) ?? [])
    setEmployees((em.data as Profile[]) ?? [])
    setStorePoints(String(st.data?.store_points ?? ''))
    setLoading(false)
  }

  useEffect(() => { load() }, [store, month])

  const totals = useMemo(() => {
    const projection = empTargets.reduce((s, t) => s + Number(t.projection ?? 0), 0)
    const target = empTargets.reduce((s, t) => s + Number(t.points ?? 0), 0)
    return { projection, target }
  }, [empTargets])

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

  async function saveEmpTarget(empId: string, field: 'points' | 'projection', value: string) {
    if (!store) return
    const num = Number(value) || 0
    const existing = empTargets.find((t) => t.user_id === empId)
    if (existing) {
      await supabase.from('employee_targets').update({ [field]: num }).eq('id', existing.id)
    } else {
      await supabase.from('employee_targets').insert({
        store_id: store.id, user_id: empId, month,
        points: field === 'points' ? num : 0,
        projection: field === 'projection' ? num : 0,
      })
    }
    await logActivity('Ενημέρωση στόχου υπαλλήλου', `${field}: ${num}`)
    await load()
  }

  function exportCsv() {
    const rows = employees.map((e) => {
      const t = empTargets.find((x) => x.user_id === e.id)
      return [e.full_name, e.email, t?.points ?? 0, t?.projection ?? 0]
    })
    downloadCsv(`stoxoi-${month}.csv`, ['Υπάλληλος', 'Email', 'Στόχος', 'Projection'], rows)
  }

  if (loading) return <Spinner />

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
        <h2 className="font-semibold text-slate-900">Στόχοι υπαλλήλων</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                <th className="py-2 pr-2">Υπάλληλος</th>
                <th className="py-2 pr-2 text-right">Στόχος</th>
                <th className="py-2 text-right">Projection</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {employees.map((e) => {
                const t = empTargets.find((x) => x.user_id === e.id)
                const isMe = e.id === profile?.id
                const editPoints = canEdit
                const editProj = isMe || canEdit
                return (
                  <tr key={e.id}>
                    <td className="py-2 pr-2 font-medium text-slate-800">{e.full_name}</td>
                    <td className="py-2 pr-2">
                      {editPoints ? (
                        <input
                          type="number"
                          defaultValue={t?.points ?? 0}
                          onBlur={(ev) => saveEmpTarget(e.id, 'points', ev.target.value)}
                          className="w-24 rounded-lg border border-slate-300 px-2 py-1 text-right text-sm"
                        />
                      ) : (
                        <div className="text-right font-medium">{fmtNum(t?.points ?? 0)}</div>
                      )}
                    </td>
                    <td className="py-2">
                      {editProj ? (
                        <input
                          type="number"
                          defaultValue={t?.projection ?? 0}
                          onBlur={(ev) => saveEmpTarget(e.id, 'projection', ev.target.value)}
                          className="w-24 rounded-lg border border-slate-300 px-2 py-1 text-right text-sm"
                        />
                      ) : (
                        <div className="text-right">{fmtNum(t?.projection ?? 0)}</div>
                      )}
                    </td>
                  </tr>
                )
              })}
              {employees.length === 0 && (
                <tr><td colSpan={3} className="py-3 text-center text-slate-400">Δεν υπάρχουν υπάλληλοι.</td></tr>
              )}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-200 font-semibold text-slate-900">
                <td className="py-2 pr-2">Σύνολο</td>
                <td className="py-2 pr-2 text-right">{fmtNum(totals.target)}</td>
                <td className="py-2 text-right">{fmtNum(totals.projection)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>
    </div>
  )
}
