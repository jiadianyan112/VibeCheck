import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { creatorsForProject, evidences, lifecycleEvents, projects, unknownFact } from '../../mocks'
import '../../styles/tokens.css'
import '../../styles/highfi-components.css'
import { VibeLens } from '../brand'
import { ProjectCard } from './ProjectCard'

const project = projects[0]!

function renderCard(node: React.ReactNode) {
  return render(<MemoryRouter>{node}</MemoryRouter>)
}

describe('ProjectCard', () => {
  it('renders creator and Vibe Coding tools without archive metadata', () => {
    renderCard(<ProjectCard project={project} creators={creatorsForProject(project)} evidence={[evidences[0]!]} />)
    expect(screen.getByRole('link', { name: '题练工坊' })).toHaveAttribute('href', `/project/${project.id}`)
    expect(screen.getByRole('link', { name: '林序，已验证' })).toHaveAttribute('href', '/creator/creator-lin')
    expect(screen.getByText('Cursor')).toBeInTheDocument()
    expect(screen.getByText('Claude Code')).toBeInTheDocument()
    expect(screen.queryByText(/核验于/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /查看来源/ })).not.toBeInTheDocument()
  })

  it('renders compact variant without media', () => {
    renderCard(<ProjectCard project={project} variant="compact" />)
    expect(screen.queryByLabelText(/截图占位/)).not.toBeInTheDocument()
    expect(screen.getByText(project.oneLineDefinition.state === 'known' ? project.oneLineDefinition.value : '')).toBeInTheDocument()
  })

  it('renders a featured card through the centralized media stage', () => {
    renderCard(<ProjectCard project={project} variant="featured" />)
    expect(screen.getByRole('article')).toHaveClass('project-card--featured')
    expect(screen.getByRole('img', { name: '默认封面' })).toBeInTheDocument()
  })

  it('uses the first cover item and falls back to the exact unknown title', () => {
    const unnamedProject = {
      ...project,
      currentName: unknownFact<string>('作品名称尚未核验', { evidenceKey: 'project-card-unknown-name', lastVerifiedAt: null }),
      coverMedia: [
        { id: 'first-cover', kind: 'placeholder' as const, url: null, alt: '首张作品封面' },
        { id: 'second-cover', kind: 'image' as const, url: '/second-cover.webp', alt: '第二张作品封面' },
      ],
    }

    renderCard(<ProjectCard project={unnamedProject} variant="standard" />)

    expect(screen.getByRole('img', { name: '默认封面' })).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: '第二张作品封面' })).not.toBeInTheDocument()
    expect(screen.getByRole('article')).toHaveClass('project-card--standard')
  })

  it('keeps standard-card fallback lenses fully styled outside high-fidelity scope', () => {
    const { container } = render(
      <MemoryRouter>
        <div className="app-shell">
          <ProjectCard project={project} />
          <VibeLens seed="yellow-state" tone="yellow" state="active" label="黄色活动占位" />
          <VibeLens seed="cyan-state" tone="cyan" state="pending" label="青色等待占位" />
        </div>
      </MemoryRouter>,
    )

    const shell = container.querySelector('.app-shell')!
    expect(shell.querySelector('.highfi-scope')).toBeNull()

    const lens = screen.getByRole('img', { name: '默认封面' })
    const lensStyle = getComputedStyle(lens)
    expect(lensStyle.display).toBe('inline-grid')
    expect(lensStyle.width).toBe('clamp(6rem, 16vw, 12rem)')
    expect(lensStyle.background).toBe('var(--vibe-lens-fill)')
    expect(lensStyle.color).toBe('var(--brand-ink)')
    expect(lensStyle.borderRadius).toBe('50%')
    expect(lensStyle.getPropertyValue('--vibe-lens-fill')).toBe('var(--brand-lime)')
    expect(lens).toHaveClass('vibe-lens--lime', 'vibe-lens--idle')

    const activeLens = screen.getByRole('img', { name: '黄色活动占位' })
    const activeStyle = getComputedStyle(activeLens)
    expect(activeStyle.getPropertyValue('--vibe-lens-fill')).toBe('var(--brand-yellow)')
    expect(activeStyle.borderWidth).toBe('3px')

    const pendingLens = screen.getByRole('img', { name: '青色等待占位' })
    const pendingStyle = getComputedStyle(pendingLens)
    expect(pendingStyle.getPropertyValue('--vibe-lens-fill')).toBe('var(--brand-cyan)')
    expect(pendingStyle.borderStyle).toBe('dashed')

    const svg = lens.querySelector('svg')!
    const svgStyle = getComputedStyle(svg)
    expect(svgStyle.display).toBe('block')
    expect(svgStyle.width).toBe('100%')
    expect(svgStyle.height).toBe('100%')
    expect(svgStyle.transform).toContain('rotate(')

    const outlineStyle = getComputedStyle(lens.querySelector('.vibe-lens__outline')!)
    expect(outlineStyle.fill).toBe('none')
    expect(outlineStyle.stroke).toBe('currentColor')
    expect(outlineStyle.strokeWidth).toBe('4')

    const ellipseStyle = getComputedStyle(lens.querySelector('.vibe-lens__ellipse--wide')!)
    expect(ellipseStyle.fill).toBe('var(--vibe-lens-fill)')
    expect(ellipseStyle.stroke).toBe('currentColor')
    expect(ellipseStyle.strokeWidth).toBe('3')

    const notchStyle = getComputedStyle(lens.querySelector('.vibe-lens__notch')!)
    expect(notchStyle.fill).toBe('none')
    expect(notchStyle.stroke).toBe('currentColor')
    expect(notchStyle.strokeWidth).toBe('8')

    expect(getComputedStyle(lens.querySelector('.vibe-lens__spark')!).fill).toBe('currentColor')
  })

  it('renders event variant with a separate historical event', () => {
    const event = lifecycleEvents.find((item) => item.projectId === project.id)!
    renderCard(<ProjectCard project={project} variant="event" event={event} evidence={[evidences[0]!]} />)
    expect(screen.getByText(event.summary)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '查看事件来源（1）' })).toBeInTheDocument()
  })

  it('reports all interaction intents to parent callbacks', async () => {
    const user = userEvent.setup()
    const onFavorite = vi.fn(), onCompare = vi.fn()
    renderCard(<ProjectCard project={project} onToggleFavorite={onFavorite} onToggleCompare={onCompare} />)
    await user.click(screen.getByRole('button', { name: '收藏' }))
    await user.click(screen.getByRole('button', { name: '加入比较' }))
    expect(onFavorite).toHaveBeenCalledWith(project)
    expect(onCompare).toHaveBeenCalledWith(project)
  })

  it('switches a saved card directly to the cancel action without follow controls', () => {
    renderCard(<ProjectCard project={project} favorited selectedForCompare onToggleFavorite={() => undefined} onToggleCompare={() => undefined} />)
    expect(screen.getByRole('button', { name: '取消收藏' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByText('关注更新')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '移出比较' })).toBeInTheDocument()
  })
})
