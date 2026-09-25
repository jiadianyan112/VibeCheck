import { describe, expect, it } from 'vitest'
import { emptyPublishFields, publishSnapshot } from './publishDraft'
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
})
