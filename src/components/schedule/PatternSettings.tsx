import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { PatternLevel, StorePattern } from '../../lib/types'
import { Button, ErrorBox, Field, Input, Modal, SuccessBox } from '../ui'

const DAYS: { v: number; l: string }[] = [
  { v: 1, l: 'Δευτέρα' }, { v: 2, l: 'Τρίτη' }, { v: 3, l: 'Τετάρτη' },
  { v: 4, l: 'Πέμπτη' }, { v: 5, l: 'Παρασκευή' }, { v: 6, l: 'Σάββατο' },
  { v: 7, l: 'Κυριακή' },
]

interface Row {
  weekday: number
  closed: boolean
  level: PatternLevel
  start: string
  end: string
  note: string
}

export default function PatternSettings({
  open, onClose, storeId, patterns, minStaff, onSaved,
}: {
  open: boolean
  onClose: () => void
  storeId: string
  patterns: StorePattern[]
  minStaff: number
  onSaved: () => void
}) {
  const [rows, setRows] = useState<Row[]>([])
  const [staff, setStaff] = useState(minStaff)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setError(''); setSuccess('')
    setStaff(minStaff)
    setRows(DAYS.map((d) => {
      const p = patterns.find((x) => x.weekday === d.v)
      return {
        weekday: d.v,
        closed: p ? p.closed : d.v === 7,
        level: p?.level ?? 'full',
        start: p?.start_time ?? '09:00',
        end: p?.end_time ?? '21:00',
        note: p?.note ?? '',
      }
    }))
  }, [open, patterns, minStaff])

  function update(weekday: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.weekday === weekday ? { ...r, ...patch } : r)))
  }

  async function save() {
    setError(''); setSuccess('')
    setBusy(true)
    const payload = rows.map((r) => ({
      store_id: storeId,
      weekday: r.weekday,
      closed: r.closed,
      level: r.level,
      start_time: r.closed ? null : (r.start || null),
      end_time: r.closed ? null : (r.end || null),
      note: r.note.trim() || null,
    }))
    const { error: pErr } = await supabase.from('store_patterns')
      .upsert(payload, { onConflict: 'store_id,weekday' })
    if (pErr) { setBusy(false); setError(pErr.message); return }
    const { error: sErr } = await supabase.from('stores')
      .update({ min_staff: Math.max(0, Number(staff) || 0) }).eq('id', storeId)
    setBusy(false)
    if (sErr) { setError(sErr.message); return }
    setSuccess('Αποθηκεύτηκε.')
    onSaved()
  }

  async function resetFairness() {
    if (!window.confirm('Μηδενισμός όλων των μετρητών δικαιοσύνης για το κατάστημα;')) return
    setError(''); setSuccess('')
    const { error } = await supabase.from('schedule_fairness').delete().eq('store_id', storeId)
    if (error) { setError(error.message); return }
    setSuccess('Οι μετρητές δικαιοσύνης μηδενίστηκαν.')
  }

  return (
    <Modal open={open} onClose={onClose} title="Ωράριο & μοτίβα ημέρας" wide>
      <ErrorBox message={error} />
      <SuccessBox message={success} />
      <p className="mb-3 text-xs text-slate-500">
        Όρισε αν κάθε ημέρα είναι κλειστή και το μοτίβο βάρδιας. Το «Σπαστό» θεωρείται δυσκολότερη
        ημέρα και ο αλγόριθμος μοιράζει δίκαια τα ρεπό πάνω της.
      </p>

      <div className="max-h-72 overflow-y-auto rounded-lg border border-line">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-2 py-2">Ημέρα</th>
              <th className="px-2 py-2">Κλειστό</th>
              <th className="px-2 py-2">Μοτίβο</th>
              <th className="px-2 py-2">Έναρξη</th>
              <th className="px-2 py-2">Λήξη</th>
              <th className="px-2 py-2">Σημείωση</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr key={r.weekday}>
                <td className="px-2 py-1.5 font-medium text-ink">{DAYS.find((d) => d.v === r.weekday)?.l}</td>
                <td className="px-2 py-1.5">
                  <input type="checkbox" checked={r.closed} onChange={(e) => update(r.weekday, { closed: e.target.checked })} />
                </td>
                <td className="px-2 py-1.5">
                  <select
                    value={r.level}
                    disabled={r.closed}
                    onChange={(e) => update(r.weekday, { level: e.target.value as PatternLevel })}
                    className="rounded-control border border-line bg-surface px-2 py-1 text-xs disabled:opacity-40"
                  >
                    <option value="split">Σπαστό</option>
                    <option value="short">Βραχεία</option>
                    <option value="full">Πλήρης</option>
                  </select>
                </td>
                <td className="px-2 py-1.5">
                  <input type="time" value={r.start} disabled={r.closed}
                    onChange={(e) => update(r.weekday, { start: e.target.value })}
                    className="rounded-control border border-line bg-surface px-2 py-1 text-xs disabled:opacity-40" />
                </td>
                <td className="px-2 py-1.5">
                  <input type="time" value={r.end} disabled={r.closed}
                    onChange={(e) => update(r.weekday, { end: e.target.value })}
                    className="rounded-control border border-line bg-surface px-2 py-1 text-xs disabled:opacity-40" />
                </td>
                <td className="px-2 py-1.5">
                  <input value={r.note} onChange={(e) => update(r.weekday, { note: e.target.value })}
                    className="w-full rounded-control border border-line bg-surface px-2 py-1 text-xs" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 max-w-xs">
        <Field label="Ελάχιστο προσωπικό ανά ημέρα">
          <Input type="number" min={0} value={staff} onChange={(e) => setStaff(Number(e.target.value) || 0)} />
        </Field>
        <p className="mt-1 text-[11px] text-slate-500">
          0 = επιτρέπεται να κλείσει το κατάστημα αν χρειαστεί ρεπό (π.χ. 1 υπάλληλος).
        </p>
      </div>

      <div className="mt-4 rounded-control border border-line bg-slate-50 p-3">
        <div className="text-sm font-semibold text-ink">Δικαιοσύνη προγράμματος</div>
        <p className="mt-1 text-xs text-slate-500">
          Οι μετρητές «ρεπό σε σπαστά / βραχείες» διατηρούνται μεταξύ μηνών για δίκαιη κατανομή.
        </p>
        <Button variant="secondary" className="mt-2 !py-1 text-xs" onClick={resetFairness}>
          Μηδενισμός μετρητών
        </Button>
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Άκυρο</Button>
        <Button onClick={save} disabled={busy}>{busy ? 'Αποθήκευση…' : 'Αποθήκευση'}</Button>
      </div>
    </Modal>
  )
}
