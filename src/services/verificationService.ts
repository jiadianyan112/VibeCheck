import { verificationRequests } from '../mocks'
import { applyVerificationReview } from '../features/authorVerification'
import type {
  AuthorVerificationRequest,
  AuthorVerificationStatus,
  VerificationRequestId,
} from '../types'
import { notFound, runService, type ServiceOptions } from './runtime'
import type { ServiceResult } from './result'

export const verificationService = {
  async get(
    id: VerificationRequestId,
    options?: ServiceOptions,
  ): Promise<ServiceResult<AuthorVerificationRequest>> {
    const result = await runService(options, () =>
      verificationRequests.find((request) => request.id === id),
    )
    if (!result.ok) return result
    if (!result.data) return notFound('VC_VERIFICATION_NOT_FOUND', '未找到身份验证申请。')
    return { ok: true, data: result.data }
  },

  submit(request: AuthorVerificationRequest, options?: ServiceOptions) {
    return runService(options, () => {
      let status: AuthorVerificationStatus = 'pending'
      if (options?.scenario === 'review_changes_requested') status = 'changes_requested'
      if (options?.scenario === 'review_approved') status = 'verified'
      if (options?.scenario === 'review_rejected') status = 'failed'
      if (options?.scenario === 'verification_disputed') status = 'disputed'
      return applyVerificationReview(
        request,
        status as Extract<AuthorVerificationStatus, 'pending' | 'changes_requested' | 'verified' | 'failed' | 'disputed'>,
      )
    })
  },
}
