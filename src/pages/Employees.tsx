import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { fmtDate } from '../lib/constants'
import { logActivity } from '../lib/activity'
import type { Profile } from '../lib/types'
import { Badge, Card, Spinner } from '../components/ui'

export default function Employees() {
  const { profile, store } = useAuth()
  const [employees, setEmployees] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)

  const isAdmin = profile?.role === 'admin'

  async function load() {
    if (!store) return
    const { data } = await supabase.from('profiles').select('*').eq('store_id', store.id).order('created_at', { ascending: true })
    setEmployees((data as Profile[]) ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [store])

  async function toggleActive(e: Profile) {
    const next = !e.active
    await supabase.from('profiles').update({ active: next }).eq('id', e.id)
    await logActivity(next ? 'Ενεργοποίηση υπαλλήλου' : 'Απενεργοποίηση υπαλλήλου', e.full_name)
    await load()
  }

  async function toggleRole(e: Profile) {
    const next = e.role === 'admin' ? 'user' : 'admin'
    await supabase.from('profiles').update({ role: next }).eq('id', e.id)
    await logActivity('Αλλαγή ρόλου', `${e.full_name} → ${next}`)
    await load()
  }

  async function toggleEditPoints(e: Profile) {
    const next = !e.can_edit_points
    await supabase.from('profiles').update({ can_edit_points: next }).eq('id', e.id)
    await logActivity(next ? 'Εκχώρηση δικαιώματος επεξεργασίας πόντων' : 'Αφαίρεση δικαιώματος επεξεργασίας πόντων', e.full_name)
    await load()
  }

  if (loading) return <Spinner />
  if (!isAdmin) {
    return <Card><p className="text-sm text-slate-500">Μόνο ο admin βλέπει αυτή τη σελίδα.</p></Card>
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-slate-900">Υπάλληλοι</h1>

      {employees.filter((e) => !e.active).length > 0 && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800">
          ⚠️ Υπάρχουν νέοι λογαριασμοί που περιμένουν έγκριση.
        </div>
      )}

      <div className="space-y-2">
        {employees.map((e) => (
          <Card key={e.id}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 font-medium text-slate-900">
                  {e.full_name}
                  {e.id === profile?.id && <span className="text-xs text-slate-400">(εσύ)</span>}
                </div>
                <div className="text-xs text-slate-500">{e.email} · Εγγραφή: {fmtDate(e.created_at)}</div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge className={e.active ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}>
                  {e.active ? 'Ενεργός' : 'Σε αναμονή'}
                </Badge>
                <Badge className={e.role === 'admin' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'}>
                  {e.role === 'admin' ? 'Admin' : 'Υπάλληλος'}
                </Badge>
                {e.can_edit_points && <Badge className="bg-blue-100 text-blue-800">Πόντοι</Badge>}
              </div>
            </div>
            {e.id !== profile?.id && (
              <div className="mt-3 flex flex-wrap gap-2">
                <button className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-medium hover:bg-slate-100" onClick={() => toggleActive(e)}>
                  {e.active ? 'Απενεργοποίηση' : 'Έγκριση'}
                </button>
                <button className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-medium hover:bg-slate-100" onClick={() => toggleRole(e)}>
                  {e.role === 'admin' ? 'Κάνε υπάλληλο' : 'Κάνε admin'}
                </button>
                <button className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-medium hover:bg-slate-100" onClick={() => toggleEditPoints(e)}>
                  {e.can_edit_points ? 'Αφαίρεση δικαιώματος πόντων' : 'Δικαίωμα επεξεργασίας πόντων'}
                </button>
              </div>
            )}
          </Card>
        ))}
        {employees.length === 0 && <Card><p className="text-sm text-slate-500">Δεν υπάρχουν υπάλληλοι.</p></Card>}
      </div>
    </div>
  )
}
