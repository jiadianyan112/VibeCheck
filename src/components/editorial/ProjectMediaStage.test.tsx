import { fireEvent, render, screen } from '@testing-library/react'
import { ProjectMediaStage } from './ProjectMediaStage'

describe('ProjectMediaStage', () => {
  it('renders real project image media with eager high priority', () => {
    render(
      <ProjectMediaStage
        media={{ id: 'cover', kind: 'image', url: '/cover.webp', alt: '作品首页' }}
        projectId="project-1"
        title="作品一"
        tone="lime"
        priority
      />,
    )

    const image = screen.getByRole('img', { name: '作品首页' })
    expect(image).toHaveAttribute('src', '/cover.webp')
    expect(image).toHaveAttribute('width', '1600')
    expect(image).toHaveAttribute('height', '900')
    expect(image).toHaveAttribute('decoding', 'async')
    expect(image).toHaveAttribute('loading', 'eager')
    expect(image).toHaveAttribute('fetchpriority', 'high')
  })

  it('renders non-priority project image media lazily', () => {
    render(
      <ProjectMediaStage
        media={{ id: 'cover', kind: 'image', url: '/cover.webp', alt: '作品首页' }}
        projectId="project-1"
        title="作品一"
        tone="cyan"
      />,
    )

    expect(screen.getByRole('img', { name: '作品首页' })).toHaveAttribute('loading', 'lazy')
    expect(screen.getByRole('img', { name: '作品首页' })).not.toHaveAttribute('fetchpriority', 'high')
  })

  it('renders video media muted and inline without autoplay', () => {
    render(
      <ProjectMediaStage
        media={{ id: 'trailer', kind: 'video', url: '/trailer.mp4', alt: '作品演示视频' }}
        projectId="project-2"
        title="作品二"
        tone="violet"
      />,
    )

    const video = screen.getByTitle('作品二')
    expect(video).toHaveAttribute('src', '/trailer.mp4')
    expect(video).toHaveAttribute('title', '作品二')
    expect(video).toHaveAttribute('aria-label', '作品二')
    expect(video).toHaveProperty('muted', true)
    expect(video).toHaveAttribute('playsinline')
    expect(video).not.toHaveAttribute('autoplay')
  })

  it('uses the labelled Vibe Lens for placeholder media', () => {
    render(
      <ProjectMediaStage
        media={{ id: 'cover', kind: 'placeholder', url: null, alt: '暂缺截图' }}
        projectId="project-3"
        title="作品三"
        tone="yellow"
      />,
    )

    expect(screen.getByRole('img', { name: '作品三视觉占位' })).toBeInTheDocument()
    expect(screen.queryByText('暂缺截图')).not.toBeInTheDocument()
  })

  it('uses the labelled Vibe Lens for wireframe media', () => {
    render(
      <ProjectMediaStage
        media={{ id: 'cover', kind: 'wireframe', url: null, alt: '线框预览' }}
        projectId="project-4"
        title="作品四"
        tone="cyan"
      />,
    )

    expect(screen.getByRole('img', { name: '作品四视觉占位' })).toBeInTheDocument()
  })

  it('uses the labelled Vibe Lens when media is missing', () => {
    render(<ProjectMediaStage projectId="project-5" title="作品五" tone="lime" />)

    expect(screen.getByRole('img', { name: '作品五视觉占位' })).toBeInTheDocument()
  })

  it('falls back to the same labelled Vibe Lens when an image fails', () => {
    const { container } = render(
      <ProjectMediaStage
        media={{ id: 'cover', kind: 'image', url: '/broken.webp', alt: '损坏图片' }}
        projectId="project-6"
        title="作品六"
        tone="violet"
      />,
    )

    fireEvent.error(screen.getByRole('img', { name: '损坏图片' }))

    expect(screen.getByRole('img', { name: '作品六视觉占位' })).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: '损坏图片' })).not.toBeInTheDocument()
    expect(container.textContent).not.toContain('/broken.webp')
  })

  it('falls back to the same labelled Vibe Lens when a video fails', () => {
    render(
      <ProjectMediaStage
        media={{ id: 'trailer', kind: 'video', url: '/broken.mp4', alt: '损坏视频' }}
        projectId="project-7"
        title="作品七"
        tone="cyan"
      />,
    )

    fireEvent.error(screen.getByTitle('作品七'))

    expect(screen.getByRole('img', { name: '作品七视觉占位' })).toBeInTheDocument()
    expect(screen.queryByTitle('作品七')).not.toBeInTheDocument()
  })

  it('defaults to landscape and supports an explicit aspect class and custom class', () => {
    const { container } = render(
      <ProjectMediaStage
        media={{ id: 'cover', kind: 'image', url: '/cover.webp', alt: '作品首页' }}
        projectId="project-8"
        title="作品八"
        tone="lime"
        aspect="portrait"
        className="project-media-stage--featured"
      />,
    )

    const stage = container.firstElementChild
    expect(stage).toHaveClass('project-media-stage', 'project-media-stage--portrait', 'project-media-stage--featured')
  })
})
