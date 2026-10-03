import { describe, expect, it } from 'vitest'
import { emptyPublishFields, mergePublishFields, publishSnapshot, validatePublishFields } from './publishDraft'
import { editableFieldsToPatch } from '../../services/submissionApi'

describe('minimal publication payload', () => {
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
      submitterRelation: 'team_member',
      organizationName: 'VibeCheck Studio',
      detailedDescription: '这是面向公开展示的完整介绍。',
      logoUrl: 'https://example.com/logo.png',
      galleryUrls: ['https://example.com/detail-1.png'],
      videoUrl: 'https://www.bilibili.com/video/BV1xx',
      acknowledgements: [{ name: '设计伙伴', url: 'https://example.com/partner', note: '共同完成视觉方向。' }],
    }, 'https://example.com/')
    expect(snapshot.project_core.publication_details).toEqual({
      submitterRelation: 'team_member',
      organizationName: 'VibeCheck Studio',
      detailedDescription: '这是面向公开展示的完整介绍。',
      logoUrl: 'https://example.com/logo.png',
      galleryUrls: ['https://example.com/detail-1.png'],
      videoUrl: 'https://www.bilibili.com/video/BV1xx',
      acknowledgements: [{ name: '设计伙伴', url: 'https://example.com/partner', note: '共同完成视觉方向。' }],
    })
  })

  it('requires a self-described relationship and validates optional publication links', () => {
    const missingRelation = validatePublishFields({ ...emptyPublishFields, name: '作品', summary: '简介', url: 'https://example.com/', category: 'ai_learning_quiz' })
    expect(missingRelation.submitterRelation).toBe('请选择你与作品的关系')

    const invalidLinks = validatePublishFields({
      ...emptyPublishFields,
      name: '作品', summary: '简介', url: 'https://example.com/', category: 'ai_learning_quiz', submitterRelation: 'owner',
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
