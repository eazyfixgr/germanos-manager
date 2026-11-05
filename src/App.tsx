import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './lib/auth'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Targets from './pages/Targets'
import Services from './pages/Services'
import Orders from './pages/Orders'
import OrderDetail from './pages/OrderDetail'
import Schedule from './pages/Schedule'
import Tasks from './pages/Tasks'
import Requests from './pages/Requests'
import Employees from './pages/Employees'
import StoreSettings from './pages/StoreSettings'
import Organization from './pages/Organization'
import Stores from './pages/Stores'
import Security from './pages/Security'
import SupportAccess from './pages/SupportAccess'
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
  const { session, profile, loading, authError, refreshProfile, signOut } = useAuth()
  if (loading) return <Spinner />
  if (authError) return (
    <div className="mx-auto max-w-lg space-y-4 p-8" role="alert">
      <h2 className="text-lg font-semibold">Σφάλμα φόρτωσης λογαριασμού</h2>
      <p>{authError}</p>
      <Button onClick={() => { if (session) void refreshProfile(); else window.location.reload() }}>Επανάληψη</Button>
      <Button variant="secondary" onClick={() => void signOut()}>Έξοδος</Button>
    </div>
  )
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

function AdminOnly({ children, allowPlatform = false }: { children: React.ReactNode; allowPlatform?: boolean }) {
  const { isAdmin, isMaster } = useAuth()
  if (!isAdmin && !(allowPlatform && isMaster)) return <Navigate to="/" replace />
  return <>{children}</>
}

function TenantOnly({ children }: { children: React.ReactNode }) {
  const { isMaster, supportSession } = useAuth()
  if (isMaster && !supportSession) return <Navigate to="/support" replace />
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
        <Route path="/targets" element={<TenantOnly><Targets /></TenantOnly>} />
        <Route path="/services" element={<TenantOnly><Services /></TenantOnly>} />
        <Route path="/orders" element={<TenantOnly><Orders /></TenantOnly>} />
        <Route path="/orders/:id" element={<TenantOnly><OrderDetail /></TenantOnly>} />
        <Route path="/schedule" element={<TenantOnly><Schedule /></TenantOnly>} />
        <Route path="/tasks" element={<TenantOnly><Tasks /></TenantOnly>} />
        <Route path="/activity" element={<TenantOnly><Activity /></TenantOnly>} />
        <Route path="/account" element={<Account />} />
        <Route path="/requests" element={<AdminOnly allowPlatform><Requests /></AdminOnly>} />
        <Route path="/employees" element={<TenantOnly><AdminOnly><Employees /></AdminOnly></TenantOnly>} />
        <Route path="/import" element={<TenantOnly><AdminOnly><Import /></AdminOnly></TenantOnly>} />
        <Route path="/trash" element={<TenantOnly><AdminOnly><Trash /></AdminOnly></TenantOnly>} />
        <Route path="/store" element={<TenantOnly><AdminOnly><StoreSettings /></AdminOnly></TenantOnly>} />
        <Route path="/organization" element={<TenantOnly><AdminOnly><Organization /></AdminOnly></TenantOnly>} />
        <Route path="/stores" element={<MasterOnly><Stores /></MasterOnly>} />
        <Route path="/security" element={<MasterOnly><Security /></MasterOnly>} />
        <Route path="/support" element={<MasterOnly><SupportAccess /></MasterOnly>} />
      </Route>
      <Route path="*" element={<Navigate to={session ? '/' : '/login'} replace />} />
    </Routes>
  )
}
