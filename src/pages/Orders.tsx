import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { fmtDate, ORDER_STATUS } from '../lib/constants'
import { logActivity } from '../lib/activity'
import type { Order, OrderStatus } from '../lib/types'
import { Badge, Button, Card, Field, Input, Modal, Select, Spinner, Textarea } from '../components/ui'

export default function Orders() {
  const { store, profile } = useAuth()
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | OrderStatus>('all')
  const [search, setSearch] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [newOrder, setNewOrder] = useState({
    product_code: '', product_name: '', customer_name: '', customer_phone: '', notes: '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    if (!store) return
    const { data } = await supabase
      .from('orders')
      .select('*')
      .eq('store_id', store.id)
      .order('created_at', { ascending: false })
    setOrders((data as Order[]) ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [store])

  // Realtime: refresh list on any order change
  useEffect(() => {
    if (!store) return
    const channel = supabase
      .channel('orders-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, load)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [store])

  const filtered = useMemo(() => {
    let list = orders
    if (filter !== 'all') list = list.filter((o) => o.status === filter)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(
        (o) =>
          o.product_name.toLowerCase().includes(q) ||
          o.product_code.toLowerCase().includes(q) ||
          o.customer_name.toLowerCase().includes(q),
      )
    }
    return list
  }, [orders, filter, search])

  async function createOrder(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!store || !profile) return
    setBusy(true)
    const { error } = await supabase.from('orders').insert({
      store_id: store.id,
      product_code: newOrder.product_code.trim(),
      product_name: newOrder.product_name.trim(),
      customer_name: newOrder.customer_name.trim(),
      customer_phone: newOrder.customer_phone.trim() || null,
      notes: newOrder.notes.trim() || null,
      status: 'new',
      created_by: profile.id,
    })
    setBusy(false)
    if (error) { setError(error.message); return }
    await logActivity('Νέα παραγγελία', `${newOrder.product_name} (${newOrder.product_code}) για ${newOrder.customer_name}`)
    setShowNew(false)
    setNewOrder({ product_code: '', product_name: '', customer_name: '', customer_phone: '', notes: '' })
    await load()
  }

  if (loading) return <Spinner />

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-900">Παραγγελίες</h1>
        <Button onClick={() => setShowNew(true)}>+ Νέα παραγγελία</Button>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          placeholder="Αναζήτηση (προϊόν, κωδικός, πελάτης)…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select value={filter} onChange={(e) => setFilter(e.target.value as 'all' | OrderStatus)} className="sm:w-56">
          <option value="all">Όλες οι καταστάσεις</option>
          {Object.entries(ORDER_STATUS).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </Select>
      </div>

      <div className="space-y-2">
        {filtered.length === 0 && (
          <Card><p className="text-sm text-slate-500">Δεν βρέθηκαν παραγγελίες.</p></Card>
        )}
        {filtered.map((o) => (
          <Link key={o.id} to={`/orders/${o.id}`} className="block">
            <Card className="transition hover:shadow-md">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-medium text-slate-900">{o.product_name}</div>
                  <div className="text-xs text-slate-500">
                    {o.product_code} · {o.customer_name} · {fmtDate(o.created_at)}
                  </div>
                </div>
                <Badge className={ORDER_STATUS[o.status].color}>{ORDER_STATUS[o.status].label}</Badge>
              </div>
            </Card>
          </Link>
        ))}
      </div>

      <Modal open={showNew} onClose={() => setShowNew(false)} title="Νέα παραγγελία πελάτη">
        <form onSubmit={createOrder} className="space-y-3">
          {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          <Field label="Κωδικός προϊόντος">
            <Input required value={newOrder.product_code} onChange={(e) => setNewOrder({ ...newOrder, product_code: e.target.value })} />
          </Field>
          <Field label="Όνομα προϊόντος">
            <Input required value={newOrder.product_name} onChange={(e) => setNewOrder({ ...newOrder, product_name: e.target.value })} />
          </Field>
          <Field label="Όνομα πελάτη">
            <Input required value={newOrder.customer_name} onChange={(e) => setNewOrder({ ...newOrder, customer_name: e.target.value })} />
          </Field>
          <Field label="Τηλέφωνο πελάτη">
            <Input value={newOrder.customer_phone} onChange={(e) => setNewOrder({ ...newOrder, customer_phone: e.target.value })} />
          </Field>
          <Field label="Σημειώσεις">
            <Textarea value={newOrder.notes} onChange={(e) => setNewOrder({ ...newOrder, notes: e.target.value })} rows={2} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setShowNew(false)}>Άκυρο</Button>
            <Button type="submit" disabled={busy}>{busy ? 'Δημιουργία…' : 'Δημιουργία'}</Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
