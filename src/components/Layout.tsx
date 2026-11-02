import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'

type IconName =
  | 'home' | 'target' | 'box' | 'calendar' | 'inbox' | 'users' | 'store'
  | 'history' | 'shield' | 'user' | 'trash' | 'upload' | 'building' | 'layers'
  | 'check' | 'menu' | 'logout'

function Icon({ name, className = '' }: { name: IconName; className?: string }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className,
  }
  switch (name) {
    case 'home':
      return <svg {...common}><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" /></svg>
    case 'target':
      return <svg {...common}><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /></svg>
    case 'box':
      return <svg {...common}><path d="M21 8 12 3 3 8v8l9 5 9-5z" /><path d="m3 8 9 5 9-5" /><path d="M12 13v8" /></svg>
    case 'calendar':
      return <svg {...common}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 10h18" /></svg>
    case 'inbox':
      return <svg {...common}><path d="M3 13h5l2 3h4l2-3h5" /><path d="M5 5h14l2 8v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-5z" /></svg>
    case 'users':
      return <svg {...common}><circle cx="9" cy="8" r="3.5" /><path d="M3 20a6 6 0 0 1 12 0" /><path d="M16 5.5a3.5 3.5 0 0 1 0 6.5" /><path d="M18 14a6 6 0 0 1 3 5.5" /></svg>
    case 'store':
      return <svg {...common}><path d="M4 9h16v11H4z" /><path d="M3 9l2-5h14l2 5" /><path d="M9 20v-6h6v6" /></svg>
    case 'building':
      return <svg {...common}><rect x="4" y="3" width="16" height="18" rx="1" /><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2" /></svg>
    case 'history':
      return <svg {...common}><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></svg>
    case 'shield':
      return <svg {...common}><path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z" /><path d="m9 12 2 2 4-4" /></svg>
    case 'user':
      return <svg {...common}><circle cx="12" cy="8" r="4" /><path d="M4 20a8 8 0 0 1 16 0" /></svg>
    case 'trash':
      return <svg {...common}><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" /></svg>
    case 'upload':
      return <svg {...common}><path d="M12 16V4M7 8l5-4 5 4" /><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></svg>
    case 'layers':
      return <svg {...common}><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 13 9 5 9-5" /><path d="m3 17 9 5 9-5" /></svg>
    case 'check':
      return <svg {...common}><path d="m5 12 4 4L19 6" /></svg>
    case 'menu':
      return <svg {...common}><path d="M3 6h18M3 12h18M3 18h18" /></svg>
    case 'logout':
      return <svg {...common}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5m5 5H9" /></svg>
  }
}

interface Item {
  to: string
  label: string
  icon: IconName
  end: boolean
  badge?: 'requests' | 'orders'
}
interface Group { title: string; items: Item[] }

const LABELS: Record<string, string> = {
  '/': 'Αρχική',
  '/targets': 'Στόχοι',
  '/services': 'Υπηρεσίες',
  '/orders': 'Παραγγελίες',
  '/schedule': 'Πρόγραμμα',
  '/tasks': 'Εργασίες',
  '/requests': 'Αιτήσεις',
  '/employees': 'Προσωπικό',
  '/import': 'Εισαγωγή',
  '/trash': 'Κάδος',
  '/store': 'Κατάστημα',
  '/stores': 'Καταστήματα',
  '/security': 'Ασφάλεια',
  '/activity': 'Ιστορικό',
  '/account': 'Λογαριασμός',
}

function labelFor(path: string) {
  if (path.startsWith('/orders/')) return 'Παραγγελία'
  return LABELS[path] ?? 'Αρχική'
}

function roleLabel(role?: string, primary?: boolean) {
  if (role === 'master') return 'Master'
  if (role === 'admin') return primary ? 'Κύριος υπεύθυνος' : 'Υπεύθυνος'
  return 'Υπάλληλος'
}

function initials(name?: string) {
  if (!name) return '—'
  return name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()
}

function CountBadge({ n, tone }: { n: number; tone: 'red' | 'amber' }) {
  if (n <= 0) return null
  return (
    <span className={`ml-auto flex h-5 min-w-5 items-center justify-center rounded-md px-1.5 text-[10px] font-bold ${
      tone === 'red' ? 'bg-red-500/90 text-white' : 'bg-amber-400/20 text-amber-200'
    }`}>
      {n}
    </span>
  )
}

export default function Layout() {
  const {
    profile, store, stores, activeStoreId, setActiveStoreId,
    isAdmin, isMaster, signOut,
  } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [pending, setPending] = useState(0)
  const [reminders, setReminders] = useState(0)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!isAdmin) return
    let cancelled = false
    async function load() {
      const { count } = await supabase.from('profiles')
        .select('*', { count: 'exact', head: true })
        .eq('active', false).is('deleted_at', null)
      if (!cancelled) setPending(count ?? 0)
    }
    load()
    const ch = supabase.channel('pending-badge')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, load)
      .subscribe()
    return () => { cancelled = true; supabase.removeChannel(ch) }
  }, [isAdmin])

  useEffect(() => {
    if (!store) { setReminders(0); return }
    let cancelled = false
    const cutoff = new Date(Date.now() - 2 * 86400000).toISOString()
    async function load() {
      const { count } = await supabase.from('orders')
        .select('*', { count: 'exact', head: true })
        .eq('store_id', store!.id).eq('status', 'ready').lt('updated_at', cutoff)
      if (!cancelled) setReminders(count ?? 0)
    }
    load()
    const ch = supabase.channel('reminder-badge')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, load)
      .subscribe()
    return () => { cancelled = true; supabase.removeChannel(ch) }
  }, [store])

  const overview: Item[] = [
    { to: '/', label: 'Αρχική', icon: 'home', end: true },
    { to: '/targets', label: 'Στόχοι', icon: 'target', end: false },
    { to: '/services', label: 'Υπηρεσίες', icon: 'layers', end: false },
    { to: '/orders', label: 'Παραγγελίες', icon: 'box', end: false, badge: 'orders' },
    { to: '/schedule', label: 'Πρόγραμμα', icon: 'calendar', end: false },
    { to: '/tasks', label: 'Εργασίες', icon: 'check', end: false },
  ]

  const team: Item[] = []
  if (isAdmin) {
    team.push(
      { to: '/requests', label: 'Αιτήσεις', icon: 'inbox', end: false, badge: 'requests' },
      { to: '/employees', label: 'Προσωπικό', icon: 'users', end: false },
      { to: '/import', label: 'Εισαγωγή', icon: 'upload', end: false },
      { to: '/trash', label: 'Κάδος', icon: 'trash', end: false },
    )
  }

  const settings: Item[] = []
  if (isMaster) {
    settings.push({ to: '/stores', label: 'Καταστήματα', icon: 'building', end: false })
    settings.push({ to: '/security', label: 'Ασφάλεια', icon: 'shield', end: false })
  } else if (isAdmin) {
    settings.push({ to: '/store', label: 'Κατάστημα', icon: 'store', end: false })
  }
  settings.push({ to: '/activity', label: 'Ιστορικό', icon: 'history', end: false })
  settings.push({ to: '/account', label: 'Λογαριασμός', icon: 'user', end: false })

  const groups: Group[] = [
    { title: 'Επισκόπηση', items: overview },
    ...(team.length ? [{ title: 'Ομάδα & Διαχείριση', items: team }] : []),
    { title: 'Ρυθμίσεις', items: settings },
  ]

  function badgeFor(item: Item) {
    if (item.badge === 'requests') return <CountBadge n={pending} tone="red" />
    if (item.badge === 'orders') return <CountBadge n={reminders} tone="amber" />
    return null
  }

  const sidebar = (
    <>
      <div className="flex items-center gap-3 border-b border-white/10 px-5 py-6">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-[#516de8] to-[#2d54ce] text-lg font-extrabold text-white shadow-lg shadow-blue-900/30">
          G
        </div>
        <div>
          <div className="text-sm font-bold text-white">Γερμανός Manager</div>
          <div className="mt-0.5 text-[10px] tracking-wider text-slate-500">STORE OPERATIONS</div>
        </div>
      </div>

      <div className="mx-3 mt-4 rounded-[10px] border border-white/10 bg-white/[0.04] px-3 py-2.5">
        <div className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-white/10 text-slate-200">
            <Icon name="store" />
          </span>
          <div className="min-w-0">
            <div className="truncate text-[11px] font-semibold text-white">
              {isMaster ? (store?.name ?? 'Master') : (store?.name ?? '—')}
            </div>
            <div className="truncate text-[10px] text-slate-400">
              {isMaster ? 'Master · όλα τα καταστήματα' : (store?.code ?? 'Χωρίς κωδικό')}
            </div>
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-2">
        {groups.map((g) => (
          <div key={g.title}>
            <div className="px-3 pb-1 pt-4 text-[10px] font-bold uppercase tracking-[1.1px] text-slate-500">{g.title}</div>
            {g.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  `mb-0.5 flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-[13px] font-medium transition ${
                    isActive
                      ? 'bg-white/10 font-semibold text-white'
                      : 'text-slate-400 hover:bg-white/5 hover:text-white'
                  }`
                }
              >
                <Icon name={item.icon} />
                <span className="truncate">{item.label}</span>
                {badgeFor(item)}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <div className="border-t border-white/10 p-3">
        <div className="rounded-[10px] bg-white/[0.04] px-3 py-2.5">
          <div className="text-[11px] font-semibold text-slate-200">Ένας χώρος για όλα</div>
          <p className="mt-1 text-[10px] leading-relaxed text-slate-400">
            Στόχοι, υπηρεσίες, παραγγελίες, πρόγραμμα και εργασίες σε ένα περιβάλλον.
          </p>
        </div>
        <div className="mt-3 flex items-center gap-2.5 px-1">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-slate-700 text-[11px] font-bold text-slate-100">
            {initials(profile?.full_name)}
          </span>
          <div className="min-w-0">
            <div className="truncate text-[11px] font-semibold text-white">{profile?.full_name}</div>
            <div className="truncate text-[10px] text-slate-400">{roleLabel(profile?.role, profile?.is_primary)}</div>
          </div>
        </div>
      </div>
    </>
  )

  return (
    <div className="flex min-h-screen w-full bg-canvas">
      {open && (
        <div className="fixed inset-0 z-40 bg-[#0b1733]/60 sm:hidden" onClick={() => setOpen(false)} />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[262px] flex-col bg-navy text-slate-300 transition-transform duration-200 ${
          open ? 'translate-x-0' : '-translate-x-full'
        } sm:sticky sm:top-0 sm:z-auto sm:h-screen sm:w-[255px] sm:shrink-0 sm:translate-x-0`}
      >
        {sidebar}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-[61px] items-center justify-between gap-3 border-b border-line bg-surface px-4 sm:h-[68px] sm:px-7">
          <div className="flex min-w-0 items-center gap-3">
            <button
              className="grid h-9 w-9 place-items-center rounded-lg text-ink hover:bg-slate-100 sm:hidden"
              onClick={() => setOpen(true)}
              aria-label="Άνοιγμα μενού"
            >
              <Icon name="menu" className="h-5 w-5" />
            </button>
            <div className="truncate text-xs text-muted">
              Κατάστημα <span className="px-1.5 text-slate-300">/</span>
              <span className="font-semibold text-ink">{labelFor(location.pathname)}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            {isMaster && stores.length > 0 && (
              <select
                value={activeStoreId ?? ''}
                onChange={(e) => setActiveStoreId(e.target.value)}
                className="max-w-[40vw] rounded-control border border-line bg-surface px-2.5 py-2 text-xs font-medium text-ink outline-none focus:border-brand sm:max-w-none"
                title="Ενεργό κατάστημα"
              >
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}{s.code ? ` (${s.code})` : ''}
                  </option>
                ))}
              </select>
            )}
            <div className="hidden text-right sm:block">
              <div className="text-xs font-semibold leading-tight text-ink">{profile?.full_name}</div>
              <div className="text-[10px] text-muted">{roleLabel(profile?.role, profile?.is_primary)}</div>
            </div>
            <span className="hidden h-9 w-9 place-items-center rounded-lg bg-blue-50 text-[11px] font-bold text-brand sm:grid">
              {initials(profile?.full_name)}
            </span>
            <button
              className="grid h-9 w-9 place-items-center rounded-lg border border-line text-slate-600 hover:bg-slate-50"
              onClick={async () => { await signOut(); navigate('/login') }}
              aria-label="Έξοδος"
              title="Έξοδος"
            >
              <Icon name="logout" />
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-8">
          <div className="mx-auto w-full max-w-[1690px]">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
