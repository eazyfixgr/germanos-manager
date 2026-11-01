import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { currentMonth } from '../lib/constants'
import { downloadCsv } from '../lib/csv'
import { Button, Card, ErrorBox, Field, Input, Select, SuccessBox } from '../components/ui'

type Mode = 'targets' | 'orders'
type Row = Record<string, string | number>

const TEMPLATES: Record<Mode, { headers: string[]; example: (string | number)[] }> = {
  targets: { headers: ['email', 'points', 'projection'], example: ['employee@example.gr', 1000, 850] },
  orders: {
    headers: ['product_code', 'product_name', 'customer_name', 'customer_phone', 'notes'],
    example: ['G-12345', 'Samsung Galaxy S24', 'Γιώργος Παπαδόπουλος', '6900000000', 'Προκαταβολή'],
  },
}

export default function Import() {
  const { store, profile } = useAuth()
  const [mode, setMode] = useState<Mode>('targets')
  const [month, setMonth] = useState(currentMonth())
  const [rows, setRows] = useState<Row[]>([])
  const [fileName, setFileName] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [busy, setBusy] = useState(false)

  function downloadTemplate() {
    const t = TEMPLATES[mode]
    downloadCsv(`protypo-${mode}.csv`, t.headers, [t.example])
  }

  async function onFile(file: File) {
    setError(''); setSuccess(''); setRows([]); setFileName(file.name)
    try {
      const mod: any = await import('xlsx')
      const XLSX = mod.default ?? mod
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const raw = XLSX.utils.sheet_to_json(ws, { defval: '' }) as Record<string, unknown>[]
      const norm = raw.map((r) => {
        const o: Row = {}
        Object.keys(r).forEach((k) => { o[k.trim().toLowerCase()] = r[k] as string | number })
        return o
      })
      setRows(norm)
    } catch {
      setError('Δεν ήταν δυνατή η ανάγνωση του αρχείου. Δοκίμασε .xlsx ή .csv.')
    }
  }

  async function runImport() {
    setError(''); setSuccess('')
    if (!store || !profile) { setError('Δεν υπάρχει ενεργό κατάστημα.'); return }
    if (rows.length === 0) { setError('Δεν υπάρχουν γραμμές προς εισαγωγή.'); return }
    setBusy(true)

    if (mode === 'targets') {
      const { data: emps } = await supabase
        .from('profiles').select('id, email')
        .eq('store_id', store.id).eq('active', true).is('deleted_at', null)
      const byEmail = new Map((emps ?? []).map((e: { id: string; email: string }) => [e.email.toLowerCase(), e.id]))
      let ok = 0, skip = 0
      for (const r of rows) {
        const email = String(r.email ?? '').trim().toLowerCase()
        const uid = byEmail.get(email)
        if (!uid) { skip++; continue }
        const { error } = await supabase.from('employee_targets').upsert(
          { store_id: store.id, user_id: uid, month, points: Number(r.points ?? 0) || 0, projection: Number(r.projection ?? 0) || 0 },
          { onConflict: 'store_id,user_id,month' },
        )
        if (error) { skip++ } else { ok++ }
      }
      setSuccess(`Εισήχθησαν ${ok} στόχοι, αγνοήθηκαν ${skip}.`)
    } else {
      const payload = rows.map((r) => ({
        store_id: store.id,
        product_code: String(r.product_code ?? '').trim(),
        product_name: String(r.product_name ?? '').trim(),
        customer_name: String(r.customer_name ?? '').trim(),
        customer_phone: String(r.customer_phone ?? '').trim() || null,
        notes: String(r.notes ?? '').trim() || null,
        status: 'new',
        created_by: profile.id,
      })).filter((p) => p.product_name && p.customer_name)
      if (payload.length === 0) { setBusy(false); setError('Καμία έγκυρη γραμμή (χρειάζονται product_name, customer_name).'); return }
      const { error } = await supabase.from('orders').insert(payload)
      if (error) { setBusy(false); setError(error.message); return }
      setSuccess(`Εισήχθησαν ${payload.length} παραγγελίες.`)
    }

    setBusy(false)
    setRows([])
    setFileName('')
  }

  const keys = rows.length > 0 ? Object.keys(rows[0]) : []

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-slate-900">Εισαγωγή από Excel / CSV</h1>

      <Card>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Τι εισάγεις">
            <Select value={mode} onChange={(e) => { setMode(e.target.value as Mode); setRows([]); setError(''); setSuccess('') }}>
              <option value="targets">Στόχοι υπαλλήλων (ανά μήνα)</option>
              <option value="orders">Παραγγελίες πελατών</option>
            </Select>
          </Field>
          {mode === 'targets' && (
            <Field label="Μήνας">
              <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
            </Field>
          )}
        </div>

        <div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
          <div className="font-medium text-slate-700">Στήλες που χρειάζονται:</div>
          <code className="mt-1 block break-all">{TEMPLATES[mode].headers.join(' · ')}</code>
          <button className="mt-2 text-slate-700 underline" onClick={downloadTemplate}>Λήψη προτύπου CSV</button>
        </div>

        <label className="mt-3 block text-sm font-medium text-slate-700">
          Αρχείο (.xlsx / .xls / .csv)
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            className="mt-1 block w-full text-sm text-slate-500"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f) }}
          />
        </label>

        <ErrorBox message={error} />
        <SuccessBox message={success} />

        {fileName && rows.length > 0 && (
          <div className="mt-3">
            <div className="text-sm text-slate-600">{fileName}: {rows.length} γραμμές</div>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-left uppercase text-slate-500">
                    {keys.map((k) => <th key={k} className="py-1 pr-3">{k}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.slice(0, 8).map((r, i) => (
                    <tr key={i}>
                      {keys.map((k) => <td key={k} className="py-1 pr-3 text-slate-700">{String(r[k] ?? '')}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex justify-end">
              <Button onClick={runImport} disabled={busy}>{busy ? 'Εισαγωγή…' : 'Εισαγωγή'}</Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}
