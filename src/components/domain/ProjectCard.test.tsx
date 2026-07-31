import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { evidences, lifecycleEvents, projects } from '../../mocks'
import { ProjectCard } from './ProjectCard'

const project = projects[0]!

function renderCard(node: React.ReactNode) {
  return render(<MemoryRouter>{node}</MemoryRouter>)
}

describe('ProjectCard', () => {
  it('renders a standard card from props with source metadata', () => {
    renderCard(<ProjectCard project={project} evidence={[evidences[0]!]} />)
    expect(screen.getByRole('link', { name: '题练工坊' })).toHaveAttribute('href', `/projects/${project.id}`)
    expect(screen.getByText(/核验于/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '查看来源（1）' })).toBeInTheDocument()
  })

  it('renders compact variant without media', () => {
    renderCard(<ProjectCard project={project} variant="compact" />)
    expect(screen.queryByLabelText(/截图占位/)).not.toBeInTheDocument()
    expect(screen.getByText(project.oneLineDefinition.state === 'known' ? project.oneLineDefinition.value : '')).toBeInTheDocument()
  })

  it('renders event variant with a separate historical event', () => {
    const event = lifecycleEvents.find((item) => item.projectId === project.id)!
    renderCard(<ProjectCard project={project} variant="event" event={event} evidence={[evidences[0]!]} />)
    expect(screen.getByText(event.summary)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '查看事件来源（1）' })).toBeInTheDocument()
  })

  it('reports all interaction intents to parent callbacks', async () => {
    const user = userEvent.setup()
    const onFavorite = vi.fn(), onFollow = vi.fn(), onCompare = vi.fn()
    renderCard(<ProjectCard project={project} onToggleFavorite={onFavorite} onToggleFollow={onFollow} onToggleCompare={onCompare} />)
    await user.click(screen.getByRole('button', { name: '收藏' }))
    await user.click(screen.getByRole('button', { name: '关注更新' }))
    await user.click(screen.getByRole('button', { name: '加入比较' }))
    expect(onFavorite).toHaveBeenCalledWith(project)
    expect(onFollow).toHaveBeenCalledWith(project)
    expect(onCompare).toHaveBeenCalledWith(project)
  })

  it('renders selected interaction states explicitly', () => {
    renderCard(<ProjectCard project={project} favorited followed selectedForCompare onToggleFavorite={() => undefined} onToggleFollow={() => undefined} onToggleCompare={() => undefined} />)
    expect(screen.getByRole('button', { name: '已收藏' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '已关注更新' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '移出比较' })).toBeInTheDocument()
  })
})
