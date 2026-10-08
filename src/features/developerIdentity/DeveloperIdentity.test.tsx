import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { DeveloperIdentity } from './DeveloperIdentity'

const developer = {
  kind: 'individual' as const,
  displayName: '林舟',
  avatarUrl: 'https://example.com/avatar.png',
  websiteUrl: 'https://example.com/',
  creatorId: 'creator-lin',
  verificationStatus: 'verified' as const,
}

describe('DeveloperIdentity', () => {
  it('links a known creator and exposes a labelled verified shield', () => {
    render(<MemoryRouter><DeveloperIdentity developer={developer} /></MemoryRouter>)

    expect(screen.getByRole('link', { name: /林舟头像 林舟/ })).toHaveAttribute('href', '/creator/creator-lin')
    expect(screen.getByText('开发者')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '林舟：已认证的开发者' })).toHaveAttribute('title', '已认证的开发者身份')
    expect(screen.getByRole('img', { name: '林舟头像' })).toHaveAttribute('src', developer.avatarUrl)
  })

  it('uses a grey unverified shield and falls back to the first character when the image fails', async () => {
    const user = userEvent.setup()
    render(<DeveloperIdentity developer={{ ...developer, avatarUrl: 'https://example.com/missing.png', creatorId: null, verificationStatus: 'unverified', kind: 'team', displayName: '微光工作室' }} />)

    const image = screen.getByRole('img', { name: '微光工作室头像' })
    fireEvent.error(image)
    expect(await screen.findByText('微')).toBeInTheDocument()
    expect(screen.getByText('开发团队')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '微光工作室：未认证的开发团队' }))
    expect(screen.getByRole('status')).toHaveTextContent('当前作品尚未完成开发主体认证。')
  })

  it('hides the identity row when the subject is unknown but keeps the claim entry', () => {
    render(<MemoryRouter><DeveloperIdentity developer={null} claimHref="/project/project-1/verify-author" /></MemoryRouter>)
    expect(screen.queryByRole('group', { name: '作品开发主体' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '认领作品' })).toHaveAttribute('href', '/project/project-1/verify-author')
  })
})
