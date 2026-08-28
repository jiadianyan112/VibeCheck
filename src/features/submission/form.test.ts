import type { ExtractionResult } from './form'
import { submissionDraftId, userId, type SubmissionDraft } from '../../types'
import { applyExtraction, buildLearningV1Snapshot, submissionCompleteness, updateDraftField, validateSubmissionStep } from './form'

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
  it('builds the exact canonical learning.v1 snapshot with safe unknown defaults', () => {
    const snapshot = buildLearningV1Snapshot({
      fields: {
        ...applyExtraction(baseDraft, extraction).fields,
        currentName: '确认后的名称',
        publicUrl: 'https://example.test/learning',
        oneLineDefinition: '把资料变成可练习内容',
        accessStatus: 'normal',
        targetUsers: ['university_students'],
        coreProblem: '复习材料难以转成练习',
        useScenarios: ['question_generation'],
        mainInputs: ['pdf'],
        mainOutputs: ['questions'],
        coreFlow: [{ id: 'one', order: 1, label: '上传材料', description: 'ignored' }],
        practiceFormats: [],
        feedbackMethods: [],
        aiCodingTools: [],
      },
      coverMediaReferenceIds: ['55555555-5555-4555-8555-555555555555'],
      observedAt: '2026-08-25T10:00:00.000Z',
    })

    expect(Object.keys(snapshot)).toEqual(['project_core', 'category_id', 'category_schema_version', 'category_data'])
    expect(snapshot).toMatchObject({
      category_id: 'ai_learning_quiz',
      category_schema_version: 'learning.v1',
      project_core: {
        current_name: '确认后的名称',
        public_url: 'https://example.test/learning',
        one_line_definition: '把资料变成可练习内容',
        access_status: 'normal',
        repository_url: 'https://example.test/repo',
        original_platform: null,
        cover_media_reference_ids: ['55555555-5555-4555-8555-555555555555'],
        ai_coding_tools: {
          knowledge_state: 'unknown',
          values: [],
          source_type: 'system_inference',
          observed_at: '2026-08-25T10:00:00.000Z',
        },
        tech_stack: [],
        deployment_platform: null,
        maintenance_signal: 'unknown',
        status_note: null,
      },
      category_data: {
        content_processing: [],
        practice_formats: [],
        feedback_methods: [],
        learning_records: [],
        differentiation: null,
        core_features: [],
        secondary_features: [],
        login_requirement: 'unknown',
        sharing_capability: 'unknown',
      },
    })
    expect(snapshot.category_data.core_flow).toEqual([{ order: 1, name: '上传材料' }])
    expect(snapshot.project_core.ai_coding_tools.knowledge_state).not.toBe('known_empty')
  })

  it('does not manufacture required learning fields from an incomplete form', () => {
    expect(() => buildLearningV1Snapshot({
      fields: { currentName: '只有名称' },
      coverMediaReferenceIds: [],
      observedAt: '2026-08-25T10:00:00.000Z',
    })).toThrow('Learning snapshot requires coreFlow')
  })

  it('rejects catalog-invalid text before any material upload can begin', () => {
    expect(() => buildLearningV1Snapshot({
      fields: {
        currentName: '超'.repeat(81),
        publicUrl: 'https://example.test/learning',
        oneLineDefinition: '定义',
        targetUsers: ['university_students'],
        coreProblem: '问题',
        useScenarios: ['daily_practice'],
        mainInputs: ['plain_text'],
        mainOutputs: ['practice_set'],
        coreFlow: [{ id: 'one', order: 1, label: '准备材料', description: '' }],
      },
      coverMediaReferenceIds: [],
      observedAt: '2026-08-25T10:00:00.000Z',
    })).toThrow('Learning snapshot exceeds currentName limit')
  })

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
