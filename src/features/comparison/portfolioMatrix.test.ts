import { projects, reusableAssets } from '../../mocks'
import { buildComparisonMatrix } from './matrix'

describe('portfolio comparison matrix', () => {
  it('uses the formal nine Portfolio groups for same-category works', () => {
    const selected = projects.filter((project) => ['project-atlas-home', 'project-form-field', 'project-one-page-cv'].includes(project.id))
    const matrix = buildComparisonMatrix(selected, reusableAssets)
    expect(matrix.map((dimension) => dimension.label)).toEqual(['定位与用途', '内容结构', '项目展示', '视觉方向', '交互动画', '站点能力', '实现方式', '复用条件', '状态与证据'])
  })

  it('falls back to public ProjectCore dimensions for a mixed comparison', () => {
    const selected = projects.filter((project) => ['project-quizforge', 'project-atlas-home'].includes(project.id))
    const matrix = buildComparisonMatrix(selected, reusableAssets)
    expect(matrix.map((dimension) => dimension.label)).toEqual(['跨品类概览', '实现方式', '复用条件', '状态与证据'])
    expect(matrix.flatMap((dimension) => dimension.rows).some((row) => row.label === '材料输入')).toBe(false)
  })
})
