import { projectId } from '../../types'
import { duplicateDetailPath, duplicateVerificationPath, getDuplicateProjectSummary, submissionReturnPath } from './duplicate'

describe('duplicate submission branch', () => {
  it('builds the existing project summary from traceable project facts', () => {
    expect(getDuplicateProjectSummary(projectId('project-pdfquizlab'))).toEqual({
      id: projectId('project-pdfquizlab'),
      name: 'PDF 题库实验室',
      publicUrl: 'https://example.test/products/project-pdfquizlab',
      authorLinkLabel: '尚未关联作者',
      sourceLabel: '平台编辑收录',
    })
  })

  it('round-trips candidate URL and fixed scenario through detail and verification paths', () => {
    const url = 'https://example.test/new?source=submit'
    const detail = duplicateDetailPath(projectId('project-pdfquizlab'), url, 'duplicate_project')
    const verification = duplicateVerificationPath(projectId('project-pdfquizlab'), url, 'duplicate_project')
    const back = submissionReturnPath(url, 'duplicate_project')
    expect(detail).toContain('/project/project-pdfquizlab?')
    expect(verification).toContain('/project/project-pdfquizlab/verify-author?')
    expect(new URL(detail, 'https://vibecheck.test').searchParams.get('submissionUrl')).toBe(url)
    expect(new URL(back, 'https://vibecheck.test').searchParams.get('resumeUrl')).toBe(url)
  })
})
