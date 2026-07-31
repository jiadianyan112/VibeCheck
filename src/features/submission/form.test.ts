import type { ExtractionResult } from '../../services'
import { submissionDraftId, userId, type SubmissionDraft } from '../../types'
import { applyExtraction, submissionCompleteness, updateDraftField, validateSubmissionStep } from './form'

const baseDraft: SubmissionDraft = {
  id: submissionDraftId('draft-form-test'),
  userId: userId('user-mia'),
  status: 'draft',
  step: 'url',
  fields: { publicUrl: 'https://example.test/tool' },
  originalExtraction: { publicUrl: 'https://example.test/tool' },
  assetIds: [],
  duplicateProjectId: null,
  validationErrors: {},
  reviewMessages: {},
  submittedFields: null,
  submittedAssetIds: [],
  supplementalMaterial: '',
  publishedProjectId: null,
  publishedEventId: null,
  createdAt: '2026-07-31T10:00:00+08:00',
  updatedAt: '2026-07-31T10:00:00+08:00',
  submittedAt: null,
  withdrawnAt: null,
}

const extraction: ExtractionResult = {
  fields: {
    currentName: '自动名称',
    oneLineDefinition: '自动定义',
    screenshotUrl: 'https://example.test/screenshot.png',
    repositoryUrl: 'https://example.test/repo',
    accessStatus: 'normal',
  },
  failedFields: [],
}

describe('multi-step submission helpers', () => {
  it('keeps original extraction after an automatic field is corrected', () => {
    const extracted = applyExtraction(baseDraft, extraction)
    const corrected = updateDraftField(extracted, 'currentName', '人工纠正名称')
    expect(corrected.fields.currentName).toBe('人工纠正名称')
    expect(corrected.originalExtraction.currentName).toBe('自动名称')
    expect(applyExtraction(corrected, { fields: { currentName: '二次覆盖' }, failedFields: [] })).toBe(corrected)
  })

  it('validates only core fields for each module and allows optional development data to be skipped', () => {
    const extracted = applyExtraction(baseDraft, extraction)
    expect(validateSubmissionStep(extracted, 'prefill')).toEqual({})
    expect(validateSubmissionStep(extracted, 'definition')).toEqual({
      targetUsers: '至少选择一个目标用户。',
      coreProblem: '请填写要解决的核心问题。',
      useScenarios: '至少选择一个使用场景。',
    })
    expect(validateSubmissionStep(extracted, 'development')).toEqual({})
  })

  it('calculates completeness from the same ten core fields used by the form', () => {
    const complete: SubmissionDraft = {
      ...applyExtraction(baseDraft, extraction),
      fields: {
        ...applyExtraction(baseDraft, extraction).fields,
        targetUsers: ['university_students'],
        coreProblem: '把材料转成练习',
        useScenarios: ['question_generation'],
        mainInputs: ['pdf'],
        mainOutputs: ['questions'],
        coreFlow: [{ id: 'one', order: 1, label: '上传材料', description: '' }],
      },
    }
    expect(submissionCompleteness(complete)).toEqual({ completed: 10, total: 10, percent: 100 })
  })
})
