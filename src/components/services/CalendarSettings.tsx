import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { StoreCalendarDay } from '../../lib/types'
import { Button, ErrorBox, Modal } from '../ui'

interface DayRow { date: string; working: boolean; note: string }

const WEEKDAY = ['Κυρ', 'Δευ', 'Τρί', 'Τετ', 'Πέμ', 'Παρ', 'Σάβ']

function pad(n: number) { return String(n).padStart(2, '0') }

function monthDays(month: string): DayRow[] {
  const [y, m] = month.split('-').map(Number)
  const count = new Date(y, m, 0).getDate()
  return Array.from({ length: count }, (_, i) => ({
    date: `${y}-${pad(m)}-${pad(i + 1)}`,
    working: false,
    note: '',
  }))
}

export default function CalendarSettings({
  open, onClose, storeId, month, calendar, fallbackDays, onSaved,
}: {
  open: boolean
  onClose: () => void
  storeId: string
  month: string
  calendar: StoreCalendarDay[]
  fallbackDays: number[]
  onSaved: () => void
}) {
  const [rows, setRows] = useState<DayRow[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const base = useMemo(() => monthDays(month), [month])

  useEffect(() => {
    if (!open) return
    setError('')
    setRows(
      base.map((d) => {
        const existing = calendar.find((c) => c.date === d.date)
        if (existing) return { date: d.date, working: existing.is_working, note: existing.note ?? '' }
        const [y, m, day] = d.date.split('-').map(Number)
        const wd = new Date(y, m - 1, day).getDay() === 0 ? 7 : new Date(y, m - 1, day).getDay()
        return { date: d.date, working: fallbackDays.includes(wd), note: '' }
      }),
    )
  }, [open, base, calendar, fallbackDays])

  function toggleAllDefault() {
    setRows((prev) => prev.map((r) => {
      const [y, m, day] = r.date.split('-').map(Number)
      const wd = new Date(y, m - 1, day).getDay() === 0 ? 7 : new Date(y, m - 1, day).getDay()
      return { ...r, working: fallbackDays.includes(wd) }
    }))
  }

  function update(date: string, patch: Partial<DayRow>) {
    setRows((prev) => prev.map((r) => (r.date === date ? { ...r, ...patch } : r)))
  }

  async function save() {
    setError('')
    setBusy(true)
    const payload = rows.map((r) => ({
      store_id: storeId,
      date: r.date,
      is_working: r.working,
      note: r.note.trim() || null,
    }))
    const { error } = await supabase.from('store_calendar').upsert(payload, { onConflict: 'store_id,date' })
    setBusy(false)
    if (error) { setError(error.message); return }
    onSaved()
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title={`Ημερολόγιο εργάσιμων · ${month}`} wide>
      <ErrorBox message={error} />
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-xs text-slate-500">Ορίστε ποιες ημέρες είναι εργάσιμες (αργίες, Κυριακές, ειδικό ωράριο).</p>
        <Button variant="secondary" className="!px-2 !py-1 text-xs" onClick={toggleAllDefault}>Default</Button>
      </div>
      <div className="max-h-80 overflow-y-auto rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-2 py-2">Ημέρα</th>
              <th className="px-2 py-2">Εργάσιμη</th>
              <th className="px-2 py-2">Σημείωση</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => {
              const [y, m, d] = r.date.split('-').map(Number)
              const wd = WEEKDAY[new Date(y, m - 1, d).getDay()]
              return (
                <tr key={r.date}>
                  <td className="px-2 py-1.5 text-slate-700">{wd} {pad(d)}/{pad(m)}</td>
                  <td className="px-2 py-1.5">
                    <input type="checkbox" checked={r.working} onChange={(e) => update(r.date, { working: e.target.checked })} />
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      value={r.note}
                      onChange={(e) => update(r.date, { note: e.target.value })}
                      placeholder="π.χ. αργία"
                      className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Άκυρο</Button>
        <Button onClick={save} disabled={busy}>{busy ? 'Αποθήκευση…' : 'Αποθήκευση'}</Button>
      </div>
    </Modal>
  )
}
