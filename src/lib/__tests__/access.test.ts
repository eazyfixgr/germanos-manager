import { describe, expect, it } from 'vitest'
import { effectivePermissions, type StoreCapabilities } from '../access'
import type { Profile } from '../types'

const profile = { id: 'a', role: 'admin', active: true, deleted_at: null,
  is_primary: true, can_edit_points: true } as Profile
const employee: StoreCapabilities = {
  can_manage: false, can_lead: false, can_edit_points: false, org_role: null,
}

describe('effectivePermissions', () => {
  it('does not carry home-store admin, primary or points flags into another store', () => {
    expect(effectivePermissions(profile, employee)).toEqual({
      isMaster: false, isAdmin: false, isPrimary: false, canEditPoints: false, orgRole: null,
    })
  })
  it('supports an org-only admin whose legacy profile role is user', () => {
    expect(effectivePermissions({ ...profile, role: 'user' }, {
      ...employee, can_manage: true, can_lead: true, can_edit_points: true, org_role: 'admin',
    }).isAdmin).toBe(true)
  })
  it('fails closed when capabilities are missing', () => {
    expect(effectivePermissions(profile, null).isAdmin).toBe(false)
  })
  it('keeps platform master identity separate from tenant authority without support', () => {
    expect(effectivePermissions({ ...profile, role: 'master' }, null)).toEqual({
      isMaster: true, isAdmin: false, isPrimary: false, canEditPoints: false, orgRole: null,
    })
  })
  it('does not authorize inactive or deleted privileged accounts', () => {
    expect(effectivePermissions({ ...profile, active: false, role: 'master' }, null).isMaster).toBe(false)
    expect(effectivePermissions({ ...profile, deleted_at: '2026-11-05' }, employee).isAdmin).toBe(false)
  })
})
