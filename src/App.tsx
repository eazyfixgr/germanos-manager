import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './lib/auth'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Targets from './pages/Targets'
import Orders from './pages/Orders'
import OrderDetail from './pages/OrderDetail'
import Schedule from './pages/Schedule'
import Employees from './pages/Employees'
import Activity from './pages/Activity'
import { Spinner } from './components/ui'

function Protected({ children }: { children: React.ReactNode }) {
  const { session, profile, loading } = useAuth()
  if (loading) return <Spinner />
  if (!session) return <Navigate to="/login" replace />
  if (!profile) return <Spinner />
  if (!profile.active) {
    return (
      <div className="mx-auto max-w-md rounded-xl bg-white p-8 text-center shadow-sm border border-slate-200">
        <div className="text-3xl mb-3">⏳</div>
        <h2 className="text-lg font-semibold">Αναμονή έγκρισης</h2>
        <p className="mt-2 text-sm text-slate-600">
          Ο λογαριασμός σου περιμένει έγκριση από τον διαχειριστή του καταστήματος.
        </p>
      </div>
    )
  }
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
        <Route path="/employees" element={<Employees />} />
        <Route path="/activity" element={<Activity />} />
      </Route>
      <Route path="*" element={<Navigate to={session ? '/' : '/login'} replace />} />
    </Routes>
  )
}
