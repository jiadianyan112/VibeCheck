import { projectById, reusableAssets } from '../../mocks'
import { projectId } from '../../types'
import { buildComparisonMatrix } from './matrix'

function project(id: string) {
  return projectById.get(projectId(id))!
}

describe('structured comparison matrix', () => {
  it('builds all required dimensions for multiple projects', () => {
    const matrix = buildComparisonMatrix([
      project('project-speakmirror'),
      project('project-oralaiexam'),
      project('project-echoscore'),
    ], reusableAssets)
    expect(matrix.map(({ label }) => label)).toEqual(['定位', '输入输出', '流程', '功能', '实现', '当前状态', '可复用资产'])
    expect(matrix.flatMap(({ rows }) => rows).every(({ cells }) => cells.length === 3)).toBe(true)
    expect(matrix.flatMap(({ rows }) => rows).some(({ isSame }) => !isSame)).toBe(true)
  })

  it('marks a structurally equal row so the page can collapse it', () => {
    const quizForge = project('project-quizforge')
    const matrix = buildComparisonMatrix([quizForge, quizForge], reusableAssets)
    const knownRows = matrix.flatMap(({ rows }) => rows).filter(({ cells }) => cells.every(({ state }) => state === 'known'))
    expect(knownRows.every(({ isSame }) => isSame)).toBe(true)
  })

  it('preserves unknown field reasons instead of inventing values', () => {
    const matrix = buildComparisonMatrix([
      project('project-dailydrill'),
      project('project-learntrack'),
    ], reusableAssets)
    const models = matrix.find(({ id }) => id === 'implementation')?.rows.find(({ id }) => id === 'models')
    expect(models?.cells.every(({ state, reason }) => state === 'unknown' && Boolean(reason))).toBe(true)
    expect(models?.isSame).toBe(false)
  })

  it('keeps expired verification metadata visible in every field', () => {
    const matrix = buildComparisonMatrix([
      project('project-learntrack'),
      project('project-quizforge'),
    ], reusableAssets)
    expect(matrix.flatMap(({ rows }) => rows).every(({ cells }) => cells[0]?.freshness === 'expired')).toBe(true)
    expect(matrix.find(({ id }) => id === 'status')?.rows.find(({ id }) => id === 'freshness')?.cells[0]?.lines).toEqual(['信息已过期'])
  })
})
