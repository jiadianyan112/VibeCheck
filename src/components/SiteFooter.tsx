import { Link } from 'react-router-dom'
import { BrandMark } from './brand'

export interface SiteFooterProps {
  submitPath: string
  compact?: boolean
}

export function SiteFooter({ submitPath, compact = false }: SiteFooterProps) {
  const className = ['site-footer', compact ? 'site-footer--compact' : ''].filter(Boolean).join(' ')

  return (
    <footer className={className}>
      <div className="site-footer__inner">
        <div className="site-footer__identity">
          <BrandMark compact={compact} />
          <p>让值得被发现的作品，留下清晰的证据。</p>
        </div>
        <nav className="site-footer__navigation" aria-label="页脚导航">
          <Link to="/projects">作品广场</Link>
          <Link to="/categories">浏览分类</Link>
          <Link to={submitPath}>发布作品</Link>
          <Link to="/about">了解收录规则</Link>
        </nav>
      </div>
    </footer>
  )
}
