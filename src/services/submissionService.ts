import { projects, submissionDrafts } from '../mocks'
import {
  projectId,
  type ProjectId,
  type ReviewStatus,
  type SubmissionDraft,
  type SubmissionProjectFields,
} from '../types'
import { runService, validationFailure, type ServiceOptions } from './runtime'
import type { ServiceResult } from './result'

export interface UrlCheckItem {
  key: 'format' | 'safety' | 'access' | 'duplicate' | 'category'
  status: 'passed' | 'warning' | 'failed'
  message: string
}

export interface UrlCheckResult {
  normalizedUrl: string
  checks: UrlCheckItem[]
  duplicateProjectId: ProjectId | null
  canCreateDraft: boolean
}

export interface ExtractionResult {
  fields: Partial<SubmissionProjectFields>
  failedFields: Array<keyof SubmissionProjectFields>
}

function normalizeUrl(value: string) {
  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`
  return new URL(withProtocol).toString()
}

export const submissionService = {
  async checkUrl(
    value: string,
    options?: ServiceOptions,
  ): Promise<ServiceResult<UrlCheckResult>> {
    let normalizedUrl: string
    try {
      normalizedUrl = normalizeUrl(value.trim())
    } catch {
      return validationFailure('VC_URL_INVALID', '请输入可识别的公开 URL。')
    }
    return runService(options, () => {
      const risky = options?.scenario === 'external_link_risk' || normalizedUrl.includes('unsafe')
      const duplicate =
        options?.scenario === 'duplicate_project'
          ? projects[1]?.id ?? projectId('project-pdfquizlab')
          : projects.find((project) =>
              project.publicUrl.state === 'known'
                ? project.publicUrl.value === normalizedUrl
                : false,
            )?.id ?? null
      const checks: UrlCheckItem[] = [
        { key: 'format', status: 'passed', message: 'URL 格式有效。' },
        {
          key: 'safety',
          status: risky ? 'failed' : 'passed',
          message: risky ? '检测到外链风险，已阻止继续。' : '未发现明显安全风险。',
        },
        {
          key: 'access',
          status: options?.scenario === 'timeout' ? 'warning' : 'passed',
          message: options?.scenario === 'timeout' ? '暂时无法验证访问状态。' : '公开页面可访问。',
        },
        {
          key: 'duplicate',
          status: duplicate ? 'warning' : 'passed',
          message: duplicate ? '发现已有作品档案。' : '未发现重复档案。',
        },
        { key: 'category', status: 'passed', message: '符合首期学习与题库品类。' },
      ]
      return {
        normalizedUrl,
        checks,
        duplicateProjectId: duplicate,
        canCreateDraft: !risky && !duplicate,
      }
    })
  },

  extract(url: string, options?: ServiceOptions) {
    return runService(options, () => {
      const partial = options?.scenario === 'extraction_partial'
      const fields: Partial<SubmissionProjectFields> = {
        publicUrl: url,
        currentName: '自动提取的作品名称',
        oneLineDefinition: '从公开页面提取的作品说明，需作者确认。',
        repositoryUrl: partial ? undefined : 'https://example.test/repos/extracted-project',
      }
      return {
        fields,
        failedFields: partial ? ['repositoryUrl', 'oneLineDefinition'] : [],
      } satisfies ExtractionResult
    })
  },

  getDraft(id: SubmissionDraft['id'], options?: ServiceOptions) {
    return runService(options, () =>
      submissionDrafts.find((draft) => draft.id === id) ?? null,
    )
  },

  submit(draft: SubmissionDraft, options?: ServiceOptions) {
    return runService(options, () => {
      let status: ReviewStatus = 'pending_review'
      if (options?.scenario === 'review_changes_requested') status = 'changes_requested'
      if (options?.scenario === 'review_approved') status = 'approved'
      if (options?.scenario === 'review_rejected') status = 'rejected'
      return { ...draft, status, submittedAt: '2026-07-31T10:30:00+08:00' }
    })
  },
}
