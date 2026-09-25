export const pendingActionTypes = [
  'set_project_favorite',
  'set_project_like',
  'set_project_follow',
  'create_comment',
  'save_comparison',
  'start_submission',
] as const

export type PendingActionType = (typeof pendingActionTypes)[number]
export type PendingActionStatus = 'pending' | 'consumed' | 'cancelled' | 'expired'

export type PendingActionSubject =
  | { readonly kind: 'anonymous'; readonly id: string }
  | { readonly kind: 'user'; readonly id: string }

export type PendingActionPayload =
  | {
      readonly action_type: 'set_project_favorite' | 'set_project_like' | 'set_project_follow'
      readonly project_id: string
      readonly state: boolean
    }
  | {
      readonly action_type: 'create_comment'
      readonly project_id: string
      readonly body: string
      readonly parent_comment_id: string | null
    }
  | {
      readonly action_type: 'save_comparison'
      readonly comparison_id: string
      readonly comparison_version: number
      readonly state: true
    }
  | {
      readonly action_type: 'start_submission'
      readonly category_id: 'ai_learning_quiz' | 'personal_site_portfolio'
    }

export interface PendingActionProjection {
  readonly pending_action_id: string
  readonly action_type: PendingActionType
  readonly return_to: string
  readonly status: PendingActionStatus
  readonly expires_at: string
  readonly consumed_at: string | null
  readonly cancelled_at: string | null
  readonly cancel_reason: string | null
}

export interface PendingActionExecutionProjection extends PendingActionProjection {
  readonly payload: PendingActionPayload
  readonly client_request_id: string
}

export interface CreatePendingActionCommand {
  readonly subject: PendingActionSubject
  readonly actionType: string
  readonly parameters: Readonly<Record<string, unknown>>
  readonly returnTo: string
  readonly clientRequestId: string
  readonly requestId: string
}

export interface GetPendingActionCommand {
  readonly pendingActionId: string
  readonly subject: PendingActionSubject
  readonly identityLinkId: string | null
  readonly requestId: string
}

export type GetPendingActionExecutionCommand = GetPendingActionCommand

export interface ConsumePendingActionCommand {
  readonly pendingActionId: string
  readonly subject: { readonly kind: 'user'; readonly id: string }
  readonly identityLinkId: string
  readonly executionReceipt: string
  readonly clientRequestId: string
  readonly expectedStatus: 'pending'
  readonly requestId: string
}

export interface CompletePendingActionExecutionCommand {
  readonly pendingActionId: string
  readonly subject: { readonly kind: 'user'; readonly id: string }
  readonly identityLinkId: string
  readonly businessRequestId: string
  readonly clientRequestId: string
  readonly expectedStatus: 'pending'
  readonly requestId: string
}

export interface CancelPendingActionCommand {
  readonly pendingActionId: string
  readonly subject: PendingActionSubject
  readonly identityLinkId: string | null
  readonly cancelReason: string
  readonly clientRequestId: string
  readonly requestId: string
}

export interface PendingActionExecutionReceiptInput {
  readonly pendingActionId: string
  readonly userId: string
  readonly businessRequestId: string
  readonly result: 'success'
  readonly expiresAt: Date
}
