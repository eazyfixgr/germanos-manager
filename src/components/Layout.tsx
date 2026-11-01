import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'

const navItems = [
  { to: '/', label: 'Αρχική', icon: '🏠', end: true },
  { to: '/targets', label: 'Στόχοι', icon: '🎯', end: false },
  { to: '/orders', label: 'Παραγγελίες', icon: '📦', end: false },
  { to: '/schedule', label: 'Πρόγραμμα', icon: '📅', end: false },
  { to: '/employees', label: 'Υπάλληλοι', icon: '👥', end: false },
  { to: '/activity', label: 'Ιστορικό', icon: '📋', end: false },
]

export default function Layout() {
  const { profile, store, signOut } = useAuth()
  const navigate = useNavigate()

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-40 bg-slate-900 text-white shadow">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-lg">📱</span>
            <div>
              <div className="text-sm font-semibold leading-tight">Γερμανός Manager</div>
              <div className="text-xs text-slate-400">{store?.name ?? 'Κατάστημα'}</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-slate-300 sm:block">
              {profile?.full_name} · {profile?.role === 'admin' ? 'Admin' : 'Υπάλληλος'}
            </span>
            <button
              className="rounded-lg bg-slate-700 px-3 py-1.5 text-xs font-medium hover:bg-slate-600"
              onClick={async () => { await signOut(); navigate('/login') }}
            >
              Έξοδος
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 p-4 sm:flex-row sm:items-start">
        <aside className="shrink-0 sm:w-44">
          <nav className="flex gap-1 overflow-x-auto sm:flex-col">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${
                    isActive ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-200'
                  }`
                }
              >
                <span>{item.icon}</span>
                {item.label}
              </NavLink>
            ))}
          </nav>
        </aside>

        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
