import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './lib/auth'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Targets from './pages/Targets'
import Orders from './pages/Orders'
import OrderDetail from './pages/OrderDetail'
import Schedule from './pages/Schedule'
import Requests from './pages/Requests'
import Employees from './pages/Employees'
import StoreSettings from './pages/StoreSettings'
import Stores from './pages/Stores'
import Security from './pages/Security'
import Import from './pages/Import'
import Trash from './pages/Trash'
import Account from './pages/Account'
import Activity from './pages/Activity'
import { Button, Spinner } from './components/ui'

function Notice({ title, message }: { title: string; message: string }) {
  const { signOut } = useAuth()
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        <p className="mt-2 text-sm text-slate-600">{message}</p>
        <Button variant="secondary" className="mt-5" onClick={() => signOut()}>Έξοδος</Button>
      </div>
    </div>
  )
}

function Protected({ children }: { children: React.ReactNode }) {
  const { session, profile, loading } = useAuth()
  if (loading) return <Spinner />
  if (!session) return <Navigate to="/login" replace />
  if (!profile) return <Spinner />
  if (profile.deleted_at) {
    return <Notice title="Ο λογαριασμός έχει διαγραφεί" message="Επικοινωνήστε με τον υπεύθυνο του καταστήματος." />
  }
  if (!profile.active) {
    return <Notice title="Αναμονή έγκρισης" message="Ο λογαριασμός σου περιμένει έγκριση από τον υπεύθυνο του καταστήματος." />
  }
  return <>{children}</>
}

function AdminOnly({ children }: { children: React.ReactNode }) {
  const { isAdmin } = useAuth()
  if (!isAdmin) return <Navigate to="/" replace />
  return <>{children}</>
}

function MasterOnly({ children }: { children: React.ReactNode }) {
  const { isMaster } = useAuth()
  if (!isMaster) return <Navigate to="/" replace />
  return <>{children}</>
}

export default function App() {
  const { session } = useAuth()
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <Protected>
            <Layout />
          </Protected>
        }
      >
        <Route path="/" element={<Dashboard />} />
        <Route path="/targets" element={<Targets />} />
        <Route path="/orders" element={<Orders />} />
        <Route path="/orders/:id" element={<OrderDetail />} />
        <Route path="/schedule" element={<Schedule />} />
        <Route path="/activity" element={<Activity />} />
        <Route path="/account" element={<Account />} />
        <Route path="/requests" element={<AdminOnly><Requests /></AdminOnly>} />
        <Route path="/employees" element={<AdminOnly><Employees /></AdminOnly>} />
        <Route path="/import" element={<AdminOnly><Import /></AdminOnly>} />
        <Route path="/trash" element={<AdminOnly><Trash /></AdminOnly>} />
        <Route path="/store" element={<AdminOnly><StoreSettings /></AdminOnly>} />
        <Route path="/stores" element={<MasterOnly><Stores /></MasterOnly>} />
        <Route path="/security" element={<MasterOnly><Security /></MasterOnly>} />
      </Route>
      <Route path="*" element={<Navigate to={session ? '/' : '/login'} replace />} />
    </Routes>
  )
}
