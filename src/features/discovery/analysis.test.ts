import { projects, reusableAssets } from '../../mocks'
import type { ComparisonIntent } from '../../types'
import { buildDiscoveryAnalysis } from './analysis'

const pdfIntent: ComparisonIntent = {
  originalQuery: '把 PDF 讲义生成练习题',
  targetUsers: ['university_students'],
  useScenarios: ['question_generation'],
  inputs: ['pdf'],
  practiceFormats: ['single_choice', 'short_answer'],
  outputs: ['questions', 'practice_set'],
}

describe('discovery analysis', () => {
  it('calculates exact matches from structured intent dimensions', () => {
    const result = buildDiscoveryAnalysis(projects, reusableAssets, pdfIntent)
    expect(result.exactProjects.map(({ id }) => id)).toEqual([
      'project-quizforge',
      'project-papertopractice',
    ])
  })

  it('keeps every distribution count traceable to project ids', () => {
    const result = buildDiscoveryAnalysis(projects, reusableAssets, pdfIntent)
    expect(result.statusDistribution.every((row) => row.count === row.projectIds.length)).toBe(true)
    expect(result.assetDistribution.every((row) => row.count === row.projectIds.length)).toBe(true)
    expect(result.assetDistribution).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'source_code', projectIds: ['project-quizforge'] }),
      expect.objectContaining({ key: 'none', projectIds: ['project-papertopractice'] }),
    ]))
  })

  it('makes the deterministic representative selection reason visible to callers', () => {
    const result = buildDiscoveryAnalysis(projects, reusableAssets, pdfIntent)
    expect(result.representative?.project.id).toBe('project-quizforge')
    expect(result.representative?.reason).toContain('公开复用资产 1 项')
  })
})
