import { describe, expect, it } from 'vitest'
import { emptyPublishFields, mergePublishFields, publishSnapshot, validatePublishFields } from './publishDraft'
import { editableFieldsToPatch } from '../../services/submissionApi'

describe('minimal publication payload', () => {
  it('stores a developer identity and a fixed owner relation for new submissions', () => {
    const snapshot = publishSnapshot({
      ...emptyPublishFields,
      category: 'personal_site_portfolio',
      developerKind: 'team',
      developerName: 'VibeCheck Studio',
      developerAvatarUrl: 'https://example.com/logo.png',
      developerWebsiteUrl: 'https://example.com/',
    }, 'https://example.com/')

    expect(snapshot.project_core.publication_details).toMatchObject({
      submitterRelation: 'owner',
      developer: {
        kind: 'team',
        displayName: 'VibeCheck Studio',
        avatarUrl: 'https://example.com/logo.png',
        websiteUrl: 'https://example.com/',
      },
    })
  })

  it('requires a developer kind and name while keeping legacy relation content out of the new UI payload', () => {
    const missingKind = validatePublishFields({
      ...emptyPublishFields,
      name: '作品', summary: '简介', url: 'https://example.com/', category: 'ai_learning_quiz', developerName: '个人开发者',
    })
    expect(missingKind.developerKind).toBe('请选择开发主体类型')

    const missingName = validatePublishFields({
      ...emptyPublishFields,
      name: '作品', summary: '简介', url: 'https://example.com/', category: 'ai_learning_quiz', developerKind: 'individual',
    })
    expect(missingName.developerName).toBe('请填写开发者或团队名称')
  })

  it.each(['ai_learning_quiz', 'personal_site_portfolio'] as const)('accepts four facts without media or invented category details: %s', category => {
    const snapshot = publishSnapshot({ ...emptyPublishFields, name: 'My work', summary: 'A useful work', url: 'https://example.com/', category }, 'https://example.com/')
    expect(editableFieldsToPatch(snapshot)).toEqual(snapshot)
    expect(snapshot.project_core.cover_media_reference_ids).toEqual([])
    expect(snapshot.project_core).not.toHaveProperty('access_status')
    expect(snapshot.category_data).not.toHaveProperty('site_type')
  })
  it('only patches editor-owned facts and permits explicitly clearing a description', () => {
    const snapshot = publishSnapshot({ ...emptyPublishFields, name: 'New name', category: 'ai_learning_quiz' }, 'https://example.com/', [], { category_data: { target_users: ['student'], core_problem: 'old' } })
    expect(snapshot.category_data).toEqual({ core_problem: '' })
    expect(snapshot.category_data).not.toHaveProperty('target_users')
  })
  it('normalizes repository links and deduplicates technologies', () => {
    const snapshot = publishSnapshot({ ...emptyPublishFields, category: 'ai_learning_quiz', repository: 'github.com/example/repo', technologies: 'React，React、Python' }, 'https://example.com/')
    expect(snapshot.project_core.repository_url).toBe('https://github.com/example/repo')
    expect(snapshot.project_core.tech_stack).toEqual(['React', 'Python'])
  })
  it('stores publication details with camelCase keys for both categories', () => {
    const snapshot = publishSnapshot({
      ...emptyPublishFields,
      category: 'personal_site_portfolio',
      developerKind: 'team',
      developerName: 'VibeCheck Studio',
      developerAvatarUrl: 'https://example.com/logo.png',
      developerWebsiteUrl: 'https://example.com/',
      detailedDescription: '这是面向公开展示的完整介绍。',
      logoUrl: 'https://example.com/logo.png',
      galleryUrls: ['https://example.com/detail-1.png'],
      videoUrl: 'https://www.bilibili.com/video/BV1xx',
      acknowledgements: [{ name: '设计伙伴', url: 'https://example.com/partner', note: '共同完成视觉方向。' }],
    }, 'https://example.com/')
    expect(snapshot.project_core.publication_details).toEqual({
      submitterRelation: 'owner',
      organizationName: '',
      detailedDescription: '这是面向公开展示的完整介绍。',
      logoUrl: 'https://example.com/logo.png',
      galleryUrls: ['https://example.com/detail-1.png'],
      videoUrl: 'https://www.bilibili.com/video/BV1xx',
      acknowledgements: [{ name: '设计伙伴', url: 'https://example.com/partner', note: '共同完成视觉方向。' }],
      developer: { kind: 'team', displayName: 'VibeCheck Studio', avatarUrl: 'https://example.com/logo.png', websiteUrl: 'https://example.com/' },
    })
  })

  it('requires a developer identity and validates optional publication links', () => {
    const missingDeveloper = validatePublishFields({ ...emptyPublishFields, name: '作品', summary: '简介', url: 'https://example.com/', category: 'ai_learning_quiz' })
    expect(missingDeveloper.developerKind).toBe('请选择开发主体类型')
    expect(missingDeveloper.developerName).toBe('请填写开发者或团队名称')

    const invalidLinks = validatePublishFields({
      ...emptyPublishFields,
      name: '作品', summary: '简介', url: 'https://example.com/', category: 'ai_learning_quiz', developerKind: 'individual', developerName: '个人开发者',
      logoUrl: 'not-a-url', galleryUrls: ['https://example.com/detail.png'], videoUrl: 'https://youtube.com/watch?v=1',
      acknowledgements: [{ name: '', url: 'bad', note: '' }],
    })
    expect(invalidLinks.logoUrl).toBe('请输入有效的 Logo 链接')
    expect(invalidLinks.videoUrl).toBe('请输入 HTTPS 的 bilibili 或 b23.tv 视频链接')
    expect(invalidLinks.acknowledgements).toContain('第 1 条致谢需要填写名称和说明')
  })

  it('merges legacy IndexedDB fields with empty publication defaults', () => {
    const fields = mergePublishFields({ name: '旧草稿', category: 'personal_site_portfolio' })
    expect(fields.name).toBe('旧草稿')
    expect(fields.category).toBe('personal_site_portfolio')
    expect(fields.submitterRelation).toBe('')
    expect(fields.galleryUrls).toEqual([])
    expect(fields.acknowledgements).toEqual([])
  })

  it('sanitizes opaque remote metadata before the editor renders it', () => {
    const fields = mergePublishFields({ name: 42 as unknown as string, galleryUrls: 'bad' as unknown as string[], acknowledgements: [null as unknown as { name: string; url: string; note: string }] })
    expect(fields.name).toBe('')
    expect(fields.galleryUrls).toEqual([])
    expect(fields.acknowledgements).toEqual([{ name: '', url: '', note: '' }])
  })
})
