import { describe, expect, it } from 'vitest'

import { mapCatalogCard, mapCatalogProject } from './catalogProjectAdapter'

const projectUuid = '0f3d5d8e-7f8a-4d58-9e32-5c2a9ed8a101'
const versionUuid = 'ea4d0b7a-844e-4e22-9128-31b1b8f1a202'
const creatorUuid = '99ab1ce8-a5db-4f75-a7cd-6a8c6ed9b303'

const card = {
  project_id: projectUuid,
  version_id: versionUuid,
  current_name: '题练工坊',
  category_id: 'ai_learning_quiz',
  category_schema_version: 'learning.v1',
  one_line_definition: '把学习材料转换为可练习的题目集合。',
  cover_media_reference_ids: ['media-cover-1'],
  access_status: 'normal',
  review_status: 'published_author',
  last_verified_at: '2026-09-27T08:00:00.000Z',
  creator_summaries: [{
    creator_id: creatorUuid,
    display_name: 'Mia',
    avatar_url: null,
    verification_status: 'verified',
  }],
  ai_coding_tools: {
    knowledge_state: 'known_values',
    values: ['codex'],
    source_type: 'platform_verified_fact',
    observed_at: '2026-09-27T08:00:00.000Z',
  },
  interaction_summary: {
    favorite_count: 4,
    like_count: 7,
    follower_count: 2,
    visible_comment_count: 1,
  },
  latest_event_summary: {
    event_id: 'event-1',
    event_type: 'first_published',
    event_time: '2026-09-26T08:00:00.000Z',
    time_precision: 'day',
    event_summary: '作品首次发布',
  },
} as const

describe('catalogProjectAdapter', () => {
  it('retains publication metadata without granting ownership to a submitter', () => {
    const details = { submitterRelation: 'third_party' as const, detailedDescription: '公开功能介绍', galleryUrls: ['https://example.test/detail.png'], acknowledgements: [{ name: '工具', url: '', note: '帮助实现' }] }
    const project = mapCatalogProject({ project_id: projectUuid, project_core: { publication_details: details } } as never)
    expect(project.publicationDetails).toEqual(details)
    expect(project.creatorIds).toEqual([])
    expect(project.authorLinkStatus).toBe('unlinked')
    details.galleryUrls.push('https://example.test/later.png')
    expect(project.publicationDetails?.galleryUrls).toHaveLength(1)
  })
  it('maps a list card while preserving ids, creator facts, status, and safe unknowns', () => {
    const project = mapCatalogCard(card)

    expect(project.id).toBe(projectUuid)
    expect(project.versionIds).toEqual([versionUuid])
    expect(project.currentName).toMatchObject({ state: 'known', value: '题练工坊' })
    expect(project.oneLineDefinition).toMatchObject({
      state: 'known',
      value: '把学习材料转换为可练习的题目集合。',
    })
    expect(project.publicUrl.state).toBe('unknown')
    expect(project.categoryId).toBe('ai_learning_quiz')
    expect(project.categoryGroup).toBe('AI 学习与题库')
    expect(project.accessStatus).toMatchObject({ state: 'known', value: 'normal' })
    expect(project.reviewStatus).toBe('published_author')
    expect(project.creatorIds).toEqual([creatorUuid])
    expect(project.aiCodingTools).toMatchObject({ state: 'known', value: ['codex'] })
    expect(project.interactionSummary).toEqual({
      favoriteCount: 4,
      likeCount: 7,
      followerCount: 2,
      commentCount: 1,
    })
    expect(project.eventIds).toEqual(['event-1'])
  })

  it('maps learning detail fields and project core metadata', () => {
    const project = mapCatalogProject({
      ...card,
      first_seen_at: '2026-06-01T08:00:00.000Z',
      created_at: '2026-06-02T08:00:00.000Z',
      author_link_status: 'linked',
      completeness_level: 'complete',
      freshness_status: 'valid',
      record_source: 'author_submission',
      project_core: {
        current_name: '题练工坊',
        public_url: 'https://example.test/quizforge',
        repository_url: 'https://github.com/example/quizforge',
        original_platform: '作者官网',
        cover_media_reference_ids: ['media-cover-1'],
        one_line_definition: '把学习材料转换为可练习的题目集合。',
        ai_coding_tools: card.ai_coding_tools,
        tech_stack: ['React', 'TypeScript'],
        deployment_platform: 'Cloud Run',
        access_status: 'normal',
        maintenance_signal: 'page_updated',
        status_note: null,
      },
      category_data: {
        target_users: ['university_students'],
        core_problem: '复习材料难以组织',
        use_scenarios: ['daily_practice'],
        main_inputs: ['pdf'],
        main_outputs: ['practice_set'],
        core_flow: [
          { order: 1, name: '导入材料' },
          { order: 2, name: '完成练习' },
        ],
        content_processing: ['text_parsing'],
        practice_formats: ['single_choice'],
        feedback_methods: ['correctness'],
        learning_records: ['progress'],
        differentiation: '支持定制练习',
        core_features: ['材料导入'],
        secondary_features: ['结果分享'],
        login_requirement: 'none',
        sharing_capability: 'link',
      },
      relations: [],
      evidence_summaries: [],
    } as never)

    expect(project.publicUrl).toMatchObject({ state: 'known', value: 'https://example.test/quizforge' })
    expect(project.repositoryUrl).toMatchObject({ state: 'known', value: 'https://github.com/example/quizforge' })
    expect(project.firstSeenAt).toBe('2026-06-01T08:00:00.000Z')
    expect(project.createdAt).toBe('2026-06-02T08:00:00.000Z')
    expect(project.recordSource).toBe('author_submission')
    expect(project.authorLinkStatus).toBe('linked')
    expect(project.completenessLevel).toBe('complete')
    expect(project.techStack).toMatchObject({ state: 'known', value: ['React', 'TypeScript'] })
    expect(project.categoryData).toBeNull()
    expect(project.targetUsers).toMatchObject({ state: 'known', value: ['university_students'] })
    expect(project.coreFlow).toMatchObject({
      state: 'known',
      value: [
        { order: 1, label: '导入材料' },
        { order: 2, label: '完成练习' },
      ],
    })
  })

  it('maps portfolio category data into the frontend portfolio facts', () => {
    const project = mapCatalogProject({
      ...card,
      category_id: 'personal_site_portfolio',
      category_schema_version: 'portfolio.v1',
      project_core: {
        public_url: 'https://portfolio.example.test',
        one_line_definition: '展示产品设计和开发项目。',
        access_status: 'normal',
        maintenance_signal: 'author_updated',
        status_note: null,
      },
      category_data: {
        site_type: 'portfolio',
        creator_roles: ['designer', 'developer'],
        primary_goals: ['showcase_projects'],
        page_model: 'single_page',
        navigation_pattern: 'top_nav',
        homepage_sequence: ['hero', 'projects', 'contact'],
        core_modules: ['hero', 'projects', 'contact'],
        project_showcase_format: 'card_grid',
        case_study_depth: 'overview',
        visual_styles: ['editorial'],
        layout_patterns: ['bento'],
        color_character: 'neutral',
        theme_mode: 'light_only',
        interaction_level: 'moderate',
        interaction_patterns: ['scroll_reveal'],
        responsive_support: 'confirmed',
        blog_support: 'none',
      },
    } as never)

    expect(project.categoryId).toBe('personal_site_portfolio')
    expect(project.categorySchemaVersion).toBe('portfolio.v1')
    expect(project.categoryData).toMatchObject({
      siteType: { state: 'known', value: 'portfolio' },
      creatorRoles: { state: 'known', value: ['designer', 'developer'] },
      coreModules: { state: 'known', value: ['hero', 'projects', 'contact'] },
      layoutPatterns: { state: 'known', value: ['bento'] },
    })
    expect(project.targetUsers.state).toBe('unknown')
  })

  it('does not throw on a partial response and keeps missing values unknown', () => {
    const project = mapCatalogCard({ project_id: projectUuid })

    expect(project.id).toBe(projectUuid)
    expect(project.currentName.state).toBe('unknown')
    expect(project.oneLineDefinition.state).toBe('unknown')
    expect(project.publicUrl.state).toBe('unknown')
    expect(project.coverMedia).toEqual([])
    expect(project.creatorIds).toEqual([])
    expect(project.accessStatus).toMatchObject({ state: 'known', value: 'unknown' })
    expect(project.lastVerifiedAt).toBe('')
    expect(project.freshnessStatus).toBe('expired')
  })
})
