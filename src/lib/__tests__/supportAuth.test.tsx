// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { AuthProvider, useAuth } from '../auth'
import SupportBanner from '../../components/SupportBanner'

const backend = vi.hoisted(() => ({
  current: null as null | { id: string; store_id: string; expires: number },
  activeStore: null as string | null,
  listener: null as null | ((event: string, session: unknown) => void),
  deferCapabilities: false,
  resolveCapabilities: null as null | ((result: unknown) => void),
}))
vi.mock('../supabase', () => ({ supabase: {
  auth: {
    getSession: vi.fn(async () => ({ data: { session: { user: { id: 'master', email: 'master@example.invalid' } } }, error: null })),
    onAuthStateChange: vi.fn((listener: typeof backend.listener) => {
      backend.listener = listener
      return { data: { subscription: { unsubscribe: () => { backend.listener = null } } } }
    }),
    signOut: vi.fn(async () => { backend.listener?.('SIGNED_OUT', null); return { error: null } }),
  },
  from: vi.fn((table: string) => ({ select: () => table === 'profiles'
    ? { eq: () => ({ single: async () => ({ data: { id: 'master', role: 'master', active: true,
      deleted_at: null, store_id: null, active_store_id: backend.activeStore }, error: null }) }) }
    : { is: () => ({ order: async () => ({ data: backend.current ? [{ id: backend.current.store_id, name: backend.current.store_id }] : [], error: null }) }) },
  })),
  rpc: vi.fn(async (name: string, args?: Record<string, unknown>) => {
    if (name === 'list_support_stores') return { data: [{ id: 'A', name: 'A' }, { id: 'B', name: 'B' }], error: null }
    if (name === 'current_support_session') return { data: backend.current && backend.current.expires > Date.now() ? [{
      ...backend.current, reason: 'Synthetic support reason', started_at: new Date(Date.now() - 1000).toISOString(),
      expires_at: new Date(backend.current.expires).toISOString(), server_now: new Date().toISOString(),
    }] : [], error: null }
    if (name === 'store_capabilities') {
      const result = { data: [{ can_manage: true, can_lead: true, can_edit_points: true, org_role: null }], error: null }
      if (backend.deferCapabilities) return new Promise((resolve) => { backend.resolveCapabilities = resolve })
      return result
    }
    if (name === 'start_support_access') {
      backend.activeStore = String(args?.p_store)
      backend.current = { id: 'support-A', store_id: backend.activeStore, expires: Date.now() + 300000 }
    }
    if (name === 'end_support_access') backend.current = null
    return { data: null, error: null }
  }),
} }))

function Probe() {
  const auth = useAuth()
  if (auth.loading) return <p>Loading</p>
  return <>
    <span data-testid="scope">{auth.store?.id ?? 'platform'}</span>
    <span data-testid="authority">{String(auth.isAdmin)}</span>
    <span data-testid="identity">{auth.session?.user.id ?? 'signed-out'}</span>
    <button onClick={() => void auth.startSupport('A', 'Synthetic support reason', 5)}>Start support</button>
    <button onClick={() => void auth.signOut()}>Sign out</button>
    <SupportBanner />
  </>
}
function mount() { return render(<MemoryRouter><AuthProvider><Probe /></AuthProvider></MemoryRouter>) }
async function settle() { await act(async () => { await vi.advanceTimersByTimeAsync(1) }) }

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-05T12:00:00Z'))
  backend.current = null; backend.activeStore = null; backend.deferCapabilities = false; backend.resolveCapabilities = null
})
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('React support access lifecycle', () => {
  it('starts support from platform-only state and clears tenant authority on explicit end', async () => {
    mount(); await settle()
    expect(screen.getByTestId('scope').textContent).toBe('platform')
    expect(screen.getByTestId('authority').textContent).toBe('false')
    fireEvent.click(screen.getByText('Start support')); await settle()
    expect(screen.getByTestId('scope').textContent).toBe('A')
    expect(screen.getByTestId('authority').textContent).toBe('true')
    expect(screen.getByText('Αιτιολογία: Synthetic support reason')).toBeTruthy()
    fireEvent.click(screen.getByText('Τερματισμός πρόσβασης')); await settle()
    expect(screen.getByTestId('scope').textContent).toBe('platform')
    expect(screen.getByTestId('authority').textContent).toBe('false')
  })

  it('clears cached tenant context automatically at the server-derived deadline', async () => {
    backend.current = { id: 'support-A', store_id: 'A', expires: Date.now() + 5000 }
    backend.activeStore = 'A'
    mount(); await settle()
    expect(screen.getByTestId('scope').textContent).toBe('A')
    await act(async () => { await vi.advanceTimersByTimeAsync(5001) })
    expect(screen.getByTestId('scope').textContent).toBe('platform')
    expect(screen.getByTestId('authority').textContent).toBe('false')
    expect(screen.queryByText('Τερματισμός πρόσβασης')).toBeNull()
  })

  it('refreshes the scoped context when another tab replaces the server session', async () => {
    backend.current = { id: 'support-A', store_id: 'A', expires: Date.now() + 300000 }
    backend.activeStore = 'A'
    mount(); await settle()
    backend.current = { id: 'support-B', store_id: 'B', expires: Date.now() + 300000 }
    backend.activeStore = 'B'
    await act(async () => { await vi.advanceTimersByTimeAsync(15001) })
    expect(screen.getByTestId('scope').textContent).toBe('B')
    expect(screen.getByTestId('authority').textContent).toBe('true')
  })

  it('does not restore support context from an old capability request after sign-out', async () => {
    backend.current = { id: 'support-A', store_id: 'A', expires: Date.now() + 300000 }
    backend.activeStore = 'A'; backend.deferCapabilities = true
    mount(); await settle()
    expect(backend.resolveCapabilities).not.toBeNull()
    await act(async () => { backend.listener?.('SIGNED_OUT', null) })
    await act(async () => {
      backend.resolveCapabilities?.({ data: [{ can_manage: true, can_lead: true, can_edit_points: true }], error: null })
    })
    expect(screen.getByTestId('scope').textContent).toBe('platform')
    expect(screen.getByTestId('identity').textContent).toBe('signed-out')
    expect(screen.getByTestId('authority').textContent).toBe('false')
  })

  it('ends server support on explicit logout before clearing the local session', async () => {
    backend.current = { id: 'support-A', store_id: 'A', expires: Date.now() + 300000 }
    backend.activeStore = 'A'
    mount(); await settle()
    fireEvent.click(screen.getByText('Sign out')); await settle()
    expect(backend.current).toBeNull()
    expect(screen.getByTestId('identity').textContent).toBe('signed-out')
    expect(screen.getByTestId('authority').textContent).toBe('false')
  })
})
