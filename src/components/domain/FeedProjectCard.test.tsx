import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { creatorsForProject, projects, unknownFact } from '../../mocks'
import type { Project } from '../../types'
import { FeedProjectCard } from './FeedProjectCard'

const project = projects[0]!

function renderCard(node: React.ReactNode) {
  return render(<MemoryRouter>{node}</MemoryRouter>)
}

describe('FeedProjectCard', () => {
  it('renders a deterministic typographic cover when the project has no real media', () => {
    renderCard(
      <>
        <FeedProjectCard project={project} creators={creatorsForProject(project)} />
        <FeedProjectCard project={project} creators={creatorsForProject(project)} />
      </>,
    )

    const cards = screen.getAllByRole('article')
    expect(cards).toHaveLength(2)
    expect(cards[0]).toHaveClass('project-card', 'feed-card')
    expect(screen.getAllByRole('img', { name: '题练工坊，默认封面' })).toHaveLength(2)
    expect(screen.getAllByText('默认封面')).toHaveLength(2)
    expect(cards[0]?.querySelector('.feed-card__cover')?.className).toBe(cards[1]?.querySelector('.feed-card__cover')?.className)
    expect(screen.getAllByRole('link', { name: '题练工坊' })[0]).toHaveAttribute('href', `/project/${project.id}`)
    expect(screen.getAllByRole('link', { name: '林序，已验证' })[0]).toHaveAttribute('href', '/creator/creator-lin')
    expect(screen.getAllByText('Cursor')).toHaveLength(2)
  })

  it('uses the centralized media stage for a real image cover', () => {
    const imageProject: Project = {
      ...project,
      coverMedia: [{ id: 'real-cover', kind: 'image', url: '/real-cover.webp', alt: '作品实际封面' }],
    }

    renderCard(<FeedProjectCard project={imageProject} creators={creatorsForProject(imageProject)} />)

    const card = screen.getByRole('article')
    expect(card.querySelector('.project-media-stage')).toBeInTheDocument()
    expect(card.querySelector('.project-media-stage')).toHaveClass('project-media-stage--landscape')
    expect(screen.getByRole('img', { name: '作品实际封面' })).toHaveAttribute('src', '/real-cover.webp')
    expect(screen.queryByText('默认封面')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '查看题练工坊' })).toHaveAttribute('href', `/project/${project.id}`)
  })

  it('states why the summary is unknown instead of inventing a description', () => {
    const unknownSummaryProject: Project = {
      ...project,
      summary: unknownFact<string>('公开页面未说明摘要', {
        evidenceKey: 'feed-card-unknown-summary',
        lastVerifiedAt: null,
      }),
    }

    renderCard(<FeedProjectCard project={unknownSummaryProject} creators={creatorsForProject(project)} />)

    expect(screen.getByText('摘要未知：公开页面未说明摘要')).toBeInTheDocument()
  })

  it('shows an ended status badge on the media corner', () => {
    const endedProject: Project = {
      ...project,
      accessStatus: { ...project.accessStatus, state: 'known', value: 'ended' },
    }

    renderCard(<FeedProjectCard project={endedProject} creators={creatorsForProject(project)} />)

    expect(screen.getByText('已结束')).toBeInTheDocument()
  })

  it('shows an unknown status badge when access status is unresolved', () => {
    const unknownStatusProject: Project = {
      ...project,
      accessStatus: unknownFact('访问状态尚未核验', {
        evidenceKey: 'feed-card-unknown-status',
        lastVerifiedAt: null,
      }),
    }

    renderCard(<FeedProjectCard project={unknownStatusProject} creators={creatorsForProject(project)} />)

    expect(screen.getByText('未知')).toBeInTheDocument()
  })

  it('keeps favorite and compare names, pressed state, and parent callbacks', async () => {
    const user = userEvent.setup()
    const onFavorite = vi.fn()
    const onCompare = vi.fn()
    const view = renderCard(
      <FeedProjectCard
        project={project}
        creators={creatorsForProject(project)}
        onToggleFavorite={onFavorite}
        onToggleCompare={onCompare}
      />,
    )

    const favorite = screen.getByRole('button', { name: '收藏' })
    const compare = screen.getByRole('button', { name: '加入比较' })
    expect(favorite).toHaveAttribute('aria-pressed', 'false')
    expect(compare).toHaveAttribute('aria-pressed', 'false')
    await user.click(favorite)
    await user.click(compare)
    expect(onFavorite).toHaveBeenCalledWith(project)
    expect(onCompare).toHaveBeenCalledWith(project)

    view.rerender(
      <MemoryRouter>
        <FeedProjectCard
          project={project}
          creators={creatorsForProject(project)}
          favorited
          selectedForCompare
          onToggleFavorite={onFavorite}
          onToggleCompare={onCompare}
        />
      </MemoryRouter>,
    )
    expect(screen.getByRole('button', { name: '取消收藏' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '移出比较' })).toHaveAttribute('aria-pressed', 'true')
  })
})
