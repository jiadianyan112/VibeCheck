import { render, screen } from '@testing-library/react'
import { PublicationSummary } from './PublicationSummary'

describe('PublicationSummary', () => {
  it('summarizes the current developer identity without exposing the legacy submitter relation', () => {
    render(<PublicationSummary fields={{ developer: { kind: 'team', displayName: '微光工作室', avatarUrl: null, websiteUrl: 'https://example.com/' }, detailedDescription: '作品介绍' }} />)

    expect(screen.getByText('开发团队')).toBeInTheDocument()
    expect(screen.getByText('微光工作室')).toBeInTheDocument()
    expect(screen.queryByText('提交者关系（自述）')).not.toBeInTheDocument()
    expect(screen.queryByText('所属团队或开发者')).not.toBeInTheDocument()
  })

  it('keeps the organization name and a neutral pending message for legacy metadata', () => {
    render(<PublicationSummary fields={{ submitterRelation: 'owner', organizationName: '旧团队' }} />)
    expect(screen.getByText('旧团队')).toBeInTheDocument()
    expect(screen.getByText('开发主体资料待补充。')).toBeInTheDocument()
    expect(screen.queryByText('提交者关系（自述）')).not.toBeInTheDocument()
    expect(screen.queryByText('提交者关系不代表已验证的作者身份。')).not.toBeInTheDocument()
  })
})
