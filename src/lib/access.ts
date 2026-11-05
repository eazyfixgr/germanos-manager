import type { Profile } from './types'

export type OrganizationRole = 'owner' | 'admin' | 'member'

export interface StoreCapabilities {
  can_manage: boolean
  can_lead: boolean
  can_edit_points: boolean
  org_role: OrganizationRole | null
}

/** Profile.role is legacy home-store metadata, not authority in another store. */
export function effectivePermissions(
  profile: Profile | null,
  capabilities: StoreCapabilities | null,
) {
  const active = Boolean(profile?.active && !profile.deleted_at)
  const isMaster = active && profile?.role === 'master'
  return {
    isMaster,
    isAdmin: active && capabilities?.can_manage === true,
    isPrimary: active && capabilities?.can_lead === true,
    canEditPoints: active && capabilities?.can_edit_points === true,
    orgRole: active ? capabilities?.org_role ?? null : null,
  }
}
