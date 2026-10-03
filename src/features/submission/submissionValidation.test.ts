import { submissionDraftId, userId, type SubmissionDraft, type SubmissionProjectFields } from '../../types'
import { configureServiceRuntime, submissionService, type ExtractionResult } from '../../services'
import {
  applyExtraction,
  submissionFieldStep,
  validateSubmission,
  validateSubmissionStep,
} from './form'

const validLearningFields = {
  categoryId: 'ai_learning_quiz',
  currentName: '完整作品',
  publicUrl: 'https://example.test/learning',
  screenshotUrl: 'https://example.test/cover.png',
  accessStatus: 'normal',
  repositoryUrl: 'https://github.com/example/learning',
  oneLineDefinition: '把学习材料转成练习。',
  submitterRelation: 'third_party',
  targetUsers: ['university_students'],
  coreProblem: '学习材料难以练习。',
  useScenarios: ['daily_practice'],
  mainInputs: ['pdf'],
  mainOutputs: ['practice_set'],
  coreFlow: [{ id: 'step-1', order: 1, label: '上传材料', description: '' }],
  practiceFormats: [],
  feedbackMethods: [],
  differentiation: '',
  aiCodingTools: [],
  detailedDescription: '完整的作品说明。',
  logoUrl: 'https://example.test/logo.png',
  galleryUrls: ['https://example.test/gallery.png'],
  videoUrl: 'https://www.bilibili.com/video/BV1xx',
  acknowledgements: [{ name: '示例作者', url: '', note: '感谢公开素材。' }],
} as unknown as SubmissionProjectFields

function makeDraft(
  fields: Partial<SubmissionProjectFields> = validLearningFields,
  overrides: Partial<SubmissionDraft> = {},
): SubmissionDraft {
  return {
    id: submissionDraftId('draft-validation'),
    userId: userId('user-validation'),
    status: 'draft',
    step: 'preview',
    fields,
    originalExtraction: { publicUrl: fields.publicUrl },
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
    urlCheckPassed: true,
    ...overrides,
  }
}

describe('submission validation', () => {
  it('requires an explicit submitter relation in both category schemas', () => {
    const learning = makeDraft({ ...validLearningFields, submitterRelation: undefined })
    const portfolio = makeDraft({
      ...validLearningFields,
      categoryId: 'personal_site_portfolio',
      submitterRelation: undefined,
      creatorRoles: ['developer'],
      primaryGoals: ['showcase_projects'],
      coreModules: ['hero'],
    } as unknown as SubmissionProjectFields)

    expect(validateSubmission(learning).submitterRelation).toBeTruthy()
    expect(validateSubmission(portfolio).submitterRelation).toBeTruthy()
  })

  it('rejects credentialed or malformed publication URLs and malformed acknowledgement entries', () => {
    const errors = validateSubmission(makeDraft({
      ...validLearningFields,
      publicUrl: 'https://user:password@example.test/learning',
      screenshotUrl: 'https://user:password@example.test/cover.png',
      repositoryUrl: 'not-a-url',
      logoUrl: 'https://example.test/logo.png',
      galleryUrls: ['https://example.test/gallery.png', 'also-not-a-url'],
      videoUrl: 'http://www.bilibili.com/video/BV1xx',
      acknowledgements: [{ name: '', url: 'https://user:password@example.test/source', note: '' }],
    } as unknown as SubmissionProjectFields))

    expect(errors.publicUrl).toBeTruthy()
    expect(errors.screenshotUrl).toBeTruthy()
    expect(errors.repositoryUrl).toBeTruthy()
    expect(errors.galleryUrls).toBeTruthy()
    expect(errors.videoUrl).toBeTruthy()
    expect(errors.acknowledgements).toBeTruthy()
  })

  it('allows optional empty media and HTTPS videos hosted by bilibili or b23', () => {
    const errors = validateSubmission(makeDraft({
      ...validLearningFields,
      screenshotUrl: null,
      repositoryUrl: null,
      logoUrl: null,
      galleryUrls: [],
      videoUrl: 'https://b23.tv/abc',
      acknowledgements: [],
    } as unknown as SubmissionProjectFields))

    expect(errors).toEqual({})
  })

  it('blocks drafts whose URL check timed out or which still point at a duplicate', () => {
    const errors = validateSubmission(makeDraft(validLearningFields, {
      urlCheckPassed: false,
      validationErrors: { publicUrl: '首次访问检查超时，需重试通过后才能继续发布。' },
      duplicateProjectId: 'project-existing' as SubmissionDraft['duplicateProjectId'],
    }))

    expect(errors.publicUrl).toBeTruthy()
    expect(errors.duplicateProjectId).toBeTruthy()
  })

  it('maps new fields to their owning form step and validates only that step', () => {
    expect(submissionFieldStep('publicUrl')).toBe('prefill')
    expect(submissionFieldStep('submitterRelation')).toBe('prefill')
    expect(submissionFieldStep('organizationName')).toBe('prefill')
    expect(submissionFieldStep('logoUrl')).toBe('prefill')
    expect(submissionFieldStep('detailedDescription')).toBe('definition')
    expect(submissionFieldStep('screenshotUrl')).toBe('prefill')
    expect(submissionFieldStep('acknowledgements')).toBe('development')

    const draft = makeDraft({
      ...validLearningFields,
      publicUrl: '',
      submitterRelation: undefined,
      acknowledgements: [{ name: '', url: '', note: '' }],
    } as unknown as SubmissionProjectFields)

    const prefillErrors = validateSubmissionStep(draft, 'prefill')
    const developmentErrors = validateSubmissionStep(draft, 'development')
    expect(prefillErrors.publicUrl).toBeTruthy()
    expect(prefillErrors.submitterRelation).toBeTruthy()
    expect(prefillErrors.acknowledgements).toBeUndefined()
    expect(developmentErrors.acknowledgements).toBeTruthy()
    expect(developmentErrors.publicUrl).toBeUndefined()
  })

  it('keeps an unpassed URL check, unknown access, and the current step during extraction', () => {
    const draft = makeDraft({
      ...validLearningFields,
      accessStatus: 'unknown',
    } as unknown as SubmissionProjectFields, {
      step: 'definition',
      urlCheckPassed: false,
      validationErrors: { publicUrl: '首次访问检查超时，需重试通过后才能继续发布。' },
    })
    const extraction: ExtractionResult = {
      fields: {
        currentName: '自动提取名称',
        accessStatus: 'normal',
        repositoryUrl: 'https://example.test/repo',
      },
      failedFields: ['publicUrl'],
    }

    const updated = applyExtraction(draft, extraction)
    expect(updated.step).toBe('definition')
    expect(updated.fields.accessStatus).toBe('unknown')
    expect(updated.validationErrors.publicUrl).toContain('超时')
  })

  it('does not infer normal access while the URL check is still unpassed', () => {
    const fields = { ...validLearningFields }
    delete (fields as { accessStatus?: unknown }).accessStatus
    const draft = makeDraft(fields as unknown as SubmissionProjectFields, {
      urlCheckPassed: false,
      validationErrors: { publicUrl: '公开地址检查未通过。' },
    })
    const updated = applyExtraction(draft, {
      fields: { accessStatus: 'normal' },
      failedFields: [],
    })

    expect(updated.fields.accessStatus).toBeUndefined()
  })
})

describe('submission service validation boundary', () => {
  it('rejects an incomplete new submission before creating a review state', async () => {
    configureServiceRuntime({ defaultDelayMs: 0 })
    const result = await submissionService.submit(makeDraft({ ...validLearningFields, submitterRelation: undefined }))

    expect(result).toMatchObject({ ok: false, error: { code: 'VC_SUBMISSION_INCOMPLETE', kind: 'validation' } })
  })

  it('does not revalidate mutable fields when refreshing an existing pending review', async () => {
    configureServiceRuntime({ defaultDelayMs: 0 })
    const initial = await submissionService.submit(makeDraft(validLearningFields))
    const pending = initial.ok ? initial.data : null
    if (!pending) throw new Error('expected pending review fixture')
    const edited = { ...pending, fields: { ...pending.fields, currentName: '' } }
    const result = await submissionService.submit(edited)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.status).toBe('pending_review')
      expect(result.data.submittedFields?.currentName).toBe('完整作品')
    }
  })
})
