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
import Activity from './pages/Activity'
import { Button, Spinner } from './components/ui'

function Protected({ children }: { children: React.ReactNode }) {
  const { session, profile, loading, signOut } = useAuth()
  if (loading) return <Spinner />
  if (!session) return <Navigate to="/login" replace />
  if (!profile) return <Spinner />
  if (!profile.active) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-slate-100 p-4">
        <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Αναμονή έγκρισης</h2>
          <p className="mt-2 text-sm text-slate-600">
            Ο λογαριασμός σου έχει δημιουργηθεί και περιμένει έγκριση από τον υπεύθυνο του
            καταστήματος. Θα μπορείς να συνδεθείς μόλις εγκριθεί.
          </p>
          <Button variant="secondary" className="mt-5" onClick={() => signOut()}>
            Έξοδος
          </Button>
        </div>
      </div>
    )
  }
  return <>{children}</>
}

function AdminOnly({ children }: { children: React.ReactNode }) {
  const { isAdmin } = useAuth()
  if (!isAdmin) return <Navigate to="/" replace />
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
        <Route path="/requests" element={<AdminOnly><Requests /></AdminOnly>} />
        <Route path="/employees" element={<AdminOnly><Employees /></AdminOnly>} />
        <Route path="/store" element={<AdminOnly><StoreSettings /></AdminOnly>} />
      </Route>
      <Route path="*" element={<Navigate to={session ? '/' : '/login'} replace />} />
    </Routes>
  )
}
