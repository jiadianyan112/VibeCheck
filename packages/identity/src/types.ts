export const identityRoles = ['user', 'verified_author', 'editor', 'admin'] as const
export type IdentityRole = (typeof identityRoles)[number]

export const identityPermissions = [
  'profile:read',
  'interaction:write',
  'comparison:save',
  'submission:write',
  'author_verification:write',
  'project_update:write',
  'admin:access',
  'admin:project_edit',
  'admin:review',
  'admin:identity_review',
  'admin:system_config',
] as const
export type IdentityPermission = (typeof identityPermissions)[number]

export type AuthPurpose = 'login' | 'admin_confirm'
export type AccountStatus = 'active' | 'restricted' | 'disabled'

export interface IdentityLinkProjection {
  readonly identityLinkId: string
  readonly purpose: 'query_continuation' | 'comparison_merge'
  readonly expiresAt: string
}

export interface SessionProjection {
  readonly authenticated: true
  readonly userId: string
  readonly displayName: string
  readonly accountStatus: Exclude<AccountStatus, 'disabled'>
  readonly roles: readonly IdentityRole[]
  readonly primaryRole: IdentityRole
  readonly permissions: readonly IdentityPermission[]
  readonly sessionVersion: number
  readonly csrfToken: string
  readonly recentAuthAt: string
  readonly expiresAt: string
}

export interface StartChallengeCommand {
  readonly email: string
  readonly purpose: AuthPurpose
  readonly returnTo: string
  readonly clientRequestId: string
  readonly anonymousSubjectId: string
  readonly browserBindingToken: string | null
  readonly sessionToken: string | null
  readonly previewToken: string | null
  readonly ipAddress: string | null
  readonly userAgent: string | null
  readonly requestId: string
}

export interface StartChallengeResult {
  readonly authFlowId: string
  readonly challengeId: string
  readonly expiresAt: string
  readonly resendAfter: string
  readonly maskedEmail: string
  readonly browserBindingToken: string
}

export interface VerifyChallengeCommand {
  readonly challengeId: string
  readonly authFlowId: string
  readonly otp: string
  readonly clientRequestId: string
  readonly browserBindingToken: string | null
  readonly currentSessionToken: string | null
  readonly ipAddress: string | null
  readonly userAgent: string | null
  readonly requestId: string
}

export type VerifyChallengeResult =
  | {
      readonly purpose: 'login'
      readonly session: SessionProjection
      readonly sessionToken: string
      readonly returnTo: string
      readonly identityLinks: readonly IdentityLinkProjection[]
      readonly anonymousSubjectId: string
    }
  | {
      readonly purpose: 'admin_confirm'
      readonly reauthGrantId: string
      readonly recentAuthAt: string
      readonly returnTo: string
    }

export interface EmailOtpMessage {
  readonly to: string
  readonly code: string
  readonly expiresInMinutes: number
  readonly idempotencyKey: string
}

export interface EmailSender {
  sendOtp(message: EmailOtpMessage): Promise<{ readonly receiptId: string }>
}
