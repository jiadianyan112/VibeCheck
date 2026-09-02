import type { ExtractionResult, PortfolioV1Snapshot } from './form'
import { submissionDraftId, userId, type SubmissionDraft } from '../../types'
import { applyExtraction, buildLearningV1Snapshot, buildPortfolioV1Snapshot, submissionCompleteness, submissionCopy, updateDraftField, validateSubmissionStep } from './form'

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
  it('keeps portfolio one-line copy natural across field and validation contexts', () => {
    expect(submissionCopy('personal_site_portfolio')).toMatchObject({
      oneLineLabel: '一句话简介',
      oneLinePreviewLabel: '一句话简介',
      originalOneLineLabel: '简介',
      validationOneLineMessage: '请填写一句话简介。',
    })
    expect(submissionCopy('ai_learning_quiz')).toMatchObject({
      oneLineLabel: '一句话定义',
      oneLinePreviewLabel: '一句话介绍',
      originalOneLineLabel: '定义',
      validationOneLineMessage: '请填写一句话定义。',
    })

    const portfolioDraft: SubmissionDraft = {
      ...baseDraft,
      fields: { categoryId: 'personal_site_portfolio' },
    }
    expect(validateSubmissionStep(portfolioDraft, 'prefill').oneLineDefinition).toBe('请填写一句话简介。')
  })

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

  it('builds a complete portfolio.v1 snapshot, preserves server fields, and overlays current form fields', () => {
    const payloadSnapshot = {
      project_core: {
        original_platform: 'server-platform',
        ai_coding_tools: {
          knowledge_state: 'known_values',
          values: ['codex'],
          source_type: 'verified_author_statement',
          observed_at: '2026-08-25T10:00:00.000Z',
        },
        tech_stack: ['TypeScript'],
        deployment_platform: 'Vercel',
        maintenance_signal: 'page_updated',
        status_note: 'server note',
      },
      category_id: 'personal_site_portfolio',
      category_schema_version: 'portfolio.v1',
      category_data: {
        site_type: 'academic_homepage',
        creator_roles: ['researcher_academic'],
        primary_goals: ['academic_profile'],
        page_model: 'multi_page',
        navigation_pattern: 'top_nav',
        homepage_sequence: ['hero', 'projects'],
        core_modules: ['hero', 'projects'],
        project_showcase_format: 'case_study_list',
        case_study_depth: 'deep',
        visual_styles: ['editorial'],
        layout_patterns: ['editorial_grid'],
        color_character: 'brand_led',
        theme_mode: 'dark_only',
        interaction_level: 'moderate',
        interaction_patterns: ['scroll_reveal'],
        responsive_support: 'confirmed',
        blog_support: 'static',
        cms_support: 'headless',
        cms_platform: 'server-cms',
        multilingual_support: 'manual',
        contact_methods: ['email'],
        resume_download: 'available',
        ai_features: ['search'],
      },
    } satisfies Readonly<Record<string, unknown>>

    const snapshot: PortfolioV1Snapshot = buildPortfolioV1Snapshot({
      fields: {
        currentName: '当前作品名称',
        publicUrl: 'https://current.example/portfolio',
        oneLineDefinition: '当前作品定义',
        accessStatus: 'normal',
        repositoryUrl: null,
        creatorRoles: ['developer'],
        primaryGoals: ['showcase_projects'],
        coreModules: ['hero', 'projects', 'contact'],
      },
      coverMediaReferenceIds: ['55555555-5555-4555-8555-555555555555'],
      observedAt: '2026-08-26T10:00:00.000Z',
      payloadSnapshot,
    })

    expect(snapshot).toMatchObject({
      category_id: 'personal_site_portfolio',
      category_schema_version: 'portfolio.v1',
      project_core: {
        current_name: '当前作品名称',
        public_url: 'https://current.example/portfolio',
        one_line_definition: '当前作品定义',
        original_platform: 'server-platform',
        cover_media_reference_ids: ['55555555-5555-4555-8555-555555555555'],
        ai_coding_tools: payloadSnapshot.project_core.ai_coding_tools,
        tech_stack: ['TypeScript'],
        deployment_platform: 'Vercel',
        maintenance_signal: 'page_updated',
        status_note: 'server note',
      },
      category_data: {
        site_type: 'academic_homepage',
        creator_roles: ['developer'],
        primary_goals: ['showcase_projects'],
        core_modules: ['hero', 'projects', 'contact'],
        project_showcase_format: 'case_study_list',
        cms_support: 'headless',
        cms_platform: 'server-cms',
        multilingual_support: 'manual',
      },
    })
  })

  it('uses stable validation-safe defaults for uncollected portfolio fields', () => {
    const snapshot = buildPortfolioV1Snapshot({
      fields: {
        currentName: '默认作品',
        publicUrl: 'https://defaults.example/portfolio',
        oneLineDefinition: '默认定义',
        creatorRoles: ['developer'],
        primaryGoals: ['showcase_projects'],
        coreModules: ['hero', 'projects'],
      },
      coverMediaReferenceIds: [],
      observedAt: '2026-08-26T10:00:00.000Z',
    })

    expect(snapshot.project_core.access_status).toBe('unknown')
    expect(snapshot.category_data).toMatchObject({
      site_type: 'portfolio',
      page_model: 'single_page',
      navigation_pattern: null,
      homepage_sequence: [],
      project_showcase_format: 'none',
      case_study_depth: 'none',
      visual_styles: ['minimal'],
      layout_patterns: ['editorial_grid'],
      color_character: 'neutral',
      theme_mode: 'light_only',
      interaction_level: 'static',
      interaction_patterns: ['none'],
      responsive_support: 'unknown',
      blog_support: 'unknown',
    })
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
