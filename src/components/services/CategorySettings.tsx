import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { CategoryUnit, ServiceCategory, StoreCategory } from '../../lib/types'
import { Button, ErrorBox, Field, Input, Modal, Select } from '../ui'

interface Row {
  category_id: string
  name: string
  unit: CategoryUnit
  active: boolean
  sort_order: number
}

export default function CategorySettings({
  open, onClose, storeId, categories, storeCats, isMaster, onSaved,
}: {
  open: boolean
  onClose: () => void
  storeId: string
  categories: ServiceCategory[]
  storeCats: StoreCategory[]
  isMaster: boolean
  onSaved: () => void
}) {
  const [rows, setRows] = useState<Row[]>([])
  const [newName, setNewName] = useState('')
  const [newUnit, setNewUnit] = useState<CategoryUnit>('count')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setError('')
    setRows(
      categories
        .map((c) => {
          const o = storeCats.find((x) => x.category_id === c.id)
          return {
            category_id: c.id,
            name: c.name,
            unit: c.unit,
            active: o ? o.active : c.active,
            sort_order: o?.sort_order ?? c.sort_order,
          }
        })
        .sort((a, b) => a.sort_order - b.sort_order),
    )
  }, [open, categories, storeCats])

  function updateRow(id: string, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.category_id === id ? { ...r, ...patch } : r)))
  }

  async function save() {
    setError('')
    setBusy(true)
    const payload = rows.map((r) => ({
      store_id: storeId,
      category_id: r.category_id,
      active: r.active,
      sort_order: Number(r.sort_order) || 0,
    }))
    const { error } = await supabase
      .from('store_categories')
      .upsert(payload, { onConflict: 'store_id,category_id' })
    setBusy(false)
    if (error) { setError(error.message); return }
    onSaved()
    onClose()
  }

  async function addCategory(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!newName.trim()) { setError('Συμπληρώστε όνομα κατηγορίας.'); return }
    setBusy(true)
    const maxOrder = rows.reduce((m, r) => Math.max(m, r.sort_order), 0)
    const { error } = await supabase
      .from('service_categories')
      .insert({ name: newName.trim(), unit: newUnit, sort_order: maxOrder + 10 })
    setBusy(false)
    if (error) {
      setError(error.message.toLowerCase().includes('duplicate') ? 'Υπάρχει ήδη κατηγορία με αυτό το όνομα.' : error.message)
      return
    }
    setNewName('')
    onSaved()
  }

  return (
    <Modal open={open} onClose={onClose} title="Κατηγορίες υπηρεσιών" wide>
      <ErrorBox message={error} />
      <p className="mb-3 text-xs text-slate-500">
        Ενεργοποίηση/απενεργοποίηση και σειρά εμφάνισης για το κατάστημα. Οι στόχοι ορίζονται ξεχωριστά.
      </p>

      <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-2 py-2">Ενεργή</th>
              <th className="px-2 py-2">Κατηγορία</th>
              <th className="px-2 py-2">Μονάδα</th>
              <th className="px-2 py-2 text-right">Σειρά</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.category_id}>
                <td className="px-2 py-1.5">
                  <input
                    type="checkbox"
                    checked={r.active}
                    onChange={(e) => updateRow(r.category_id, { active: e.target.checked })}
                  />
                </td>
                <td className="px-2 py-1.5 text-slate-800">{r.name}</td>
                <td className="px-2 py-1.5 text-xs text-slate-500">
                  {r.unit === 'currency' ? 'Ευρώ' : 'Τεμάχια'}
                </td>
                <td className="px-2 py-1.5 text-right">
                  <input
                    type="number"
                    value={r.sort_order}
                    onChange={(e) => updateRow(r.category_id, { sort_order: Number(e.target.value) || 0 })}
                    className="w-20 rounded border border-slate-300 px-2 py-1 text-right text-sm"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isMaster && (
        <form onSubmit={addCategory} className="mt-4 rounded-lg bg-slate-50 p-3">
          <div className="text-sm font-medium text-slate-700">Νέα κεντρική κατηγορία (master)</div>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1">
              <Field label="Όνομα"><Input value={newName} onChange={(e) => setNewName(e.target.value)} /></Field>
            </div>
            <div className="w-32">
              <Field label="Μονάδα">
                <Select value={newUnit} onChange={(e) => setNewUnit(e.target.value as CategoryUnit)}>
                  <option value="count">Τεμάχια</option>
                  <option value="currency">Ευρώ</option>
                </Select>
              </Field>
            </div>
            <Button type="submit" variant="secondary" disabled={busy}>Προσθήκη</Button>
          </div>
        </form>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Άκυρο</Button>
        <Button onClick={save} disabled={busy}>{busy ? 'Αποθήκευση…' : 'Αποθήκευση'}</Button>
      </div>
    </Modal>
  )
}
