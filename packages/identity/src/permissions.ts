import type { AccountStatus, IdentityPermission, IdentityRole } from './types.js'

const permissionsByRole: Readonly<Record<IdentityRole, readonly IdentityPermission[]>> = {
  user: [
    'profile:read',
    'interaction:write',
    'comparison:save',
    'submission:write',
    'author_verification:write',
  ],
  verified_author: ['project_update:write'],
  editor: ['admin:access', 'admin:project_edit', 'admin:review', 'admin:identity_review'],
  admin: ['admin:system_config'],
}

const roleOrder: readonly IdentityRole[] = ['user', 'verified_author', 'editor', 'admin']

export function primaryRole(roles: readonly IdentityRole[]): IdentityRole {
  return roleOrder.findLast((role) => roles.includes(role)) ?? 'user'
}

export function permissionsFor(
  roles: readonly IdentityRole[],
  accountStatus: Exclude<AccountStatus, 'disabled'>,
): IdentityPermission[] {
  if (accountStatus === 'restricted') return ['profile:read']
  const permissions = new Set<IdentityPermission>()
  for (const role of roleOrder) {
    if (!roles.includes(role)) continue
    for (const permission of permissionsByRole[role]) permissions.add(permission)
  }
  return [...permissions]
}
