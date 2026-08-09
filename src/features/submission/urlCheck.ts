import type { UrlCheckItem, UrlCheckResult } from '../../services'
import { submissionDraftId, type ProjectCategoryId, type SubmissionDraft, type UserId } from '../../types'

export const urlCheckLabels: Record<UrlCheckItem['key'], string> = {
  format: '格式',
  safety: '安全',
  access: '访问',
  duplicate: '查重',
  category: '品类',
}

function stableHash(value: string) {
  let hash = 2166136261
  for (const character of value) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

export function createUrlCheckDraft(
  result: UrlCheckResult,
  userId: UserId,
  now = '2026-07-31T10:00:00+08:00',
  categoryId: ProjectCategoryId = 'ai_learning_quiz',
): SubmissionDraft {
  const accessTimedOut = result.checks.some(
    (check) => check.key === 'access' && check.status === 'warning',
  )
  return {
    id: submissionDraftId(`draft-url-${userId}-${stableHash(categoryId === 'ai_learning_quiz' ? result.normalizedUrl : `${categoryId}:${result.normalizedUrl}`)}`),
    userId,
    status: 'draft',
    step: 'url',
    fields: { publicUrl: result.normalizedUrl, categoryId },
    originalExtraction: { publicUrl: result.normalizedUrl, categoryId },
    assetIds: [],
    duplicateProjectId: result.duplicateProjectId,
    validationErrors: accessTimedOut
      ? { publicUrl: '首次访问检查超时，需重试通过后才能继续发布。' }
      : {},
    reviewMessages: {},
    submittedFields: null,
    submittedAssetIds: [],
    supplementalMaterial: '',
    publishedProjectId: null,
    publishedEventId: null,
    createdAt: now,
    updatedAt: now,
    submittedAt: null,
    withdrawnAt: null,
  }
}

export function canContinueAfterUrlCheck(result: UrlCheckResult) {
  return result.checks.every((check) => check.status === 'passed')
}
