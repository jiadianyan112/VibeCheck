import { useRef, useState } from 'react'
import { PageFrame } from '../components'

export function StyleSandboxPage() {
  const [isDialogOpen, setDialogOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)

  function closeDialog() {
    setDialogOpen(false)
    requestAnimationFrame(() => triggerRef.current?.focus())
  }

  return (
    <PageFrame
      title="低保真样式基线"
      description="T03 临时展示页：灰度、状态文字、焦点和窄屏布局。"
    >
      <div className="sandbox-grid">
        <section className="wire-panel stack" aria-labelledby="sandbox-actions">
          <div className="section-heading">
            <p className="eyebrow">Controls</p>
            <h2 id="sandbox-actions">操作与输入</h2>
          </div>
          <div className="cluster">
            <button className="button button--primary">主要操作</button>
            <button className="button button--secondary">次要操作</button>
            <button className="button button--quiet">文字操作</button>
            <button className="button button--primary" disabled>
              不可用
            </button>
          </div>
          <label className="field">
            <span className="field__label">作品名称或完整想法</span>
            <input className="input" placeholder="例如：把 PDF 自动生成练习题" />
            <span className="field__hint">支持作品名、功能词和完整产品想法。</span>
          </label>
          <div className="cluster" aria-label="状态标签示例">
            <span className="tag">正常可访问</span>
            <span className="tag tag--strong">需要登录</span>
            <span className="tag tag--dashed">信息待验证</span>
          </div>
        </section>

        <section className="wire-panel stack" aria-labelledby="sandbox-card">
          <div className="section-heading">
            <p className="eyebrow">Card</p>
            <h2 id="sandbox-card">作品卡片</h2>
          </div>
          <article className="wire-card stack stack--small">
            <div className="media-placeholder" aria-label="作品截图占位">
              16:9 作品截图
            </div>
            <div className="cluster cluster--between">
              <strong>题练工坊</strong>
              <span className="tag">最后验证：7 天前</span>
            </div>
            <p>把学习材料转换为可练习、可反馈的结构化题目。</p>
            <div className="cluster">
              <button className="button button--quiet">收藏</button>
              <button className="button button--quiet">关注更新</button>
              <button className="button button--secondary">加入比较</button>
            </div>
          </article>
        </section>

        <section className="wire-panel stack span-full" aria-labelledby="sandbox-table">
          <div className="section-heading">
            <p className="eyebrow">Table</p>
            <h2 id="sandbox-table">对比表与窄屏替代</h2>
          </div>
          <div className="table-scroll" tabIndex={0} aria-label="作品状态对比表，可横向滚动">
            <table className="wire-table">
              <thead>
                <tr>
                  <th scope="col">作品</th>
                  <th scope="col">当前状态</th>
                  <th scope="col">来源</th>
                  <th scope="col">最后验证</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">题练工坊</th>
                  <td>正常可访问</td>
                  <td>平台直接验证</td>
                  <td>2026-07-24</td>
                </tr>
                <tr>
                  <th scope="row">口语回声</th>
                  <td>信息待验证</td>
                  <td>已验证作者声明</td>
                  <td>2026-06-18</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="wire-panel stack" aria-labelledby="sandbox-feedback">
          <div className="section-heading">
            <p className="eyebrow">Feedback</p>
            <h2 id="sandbox-feedback">加载与空状态</h2>
          </div>
          <div className="skeleton-stack" aria-label="内容加载中">
            <span className="skeleton skeleton--title" />
            <span className="skeleton" />
            <span className="skeleton skeleton--short" />
          </div>
          <div className="empty-state">
            <strong>还没有保存的作品</strong>
            <p>从作品广场选择一个与你当前想法相关的项目。</p>
            <button className="button button--secondary">探索作品</button>
          </div>
        </section>

        <section className="wire-panel stack" aria-labelledby="sandbox-dialog">
          <div className="section-heading">
            <p className="eyebrow">Dialog</p>
            <h2 id="sandbox-dialog">弹层</h2>
          </div>
          <p>用于登录门控、确认操作和来源展开。</p>
          <button
            ref={triggerRef}
            className="button button--secondary"
            onClick={() => setDialogOpen(true)}
          >
            打开弹层示例
          </button>
        </section>
      </div>

      {isDialogOpen ? (
        <div className="dialog-backdrop" role="presentation" onMouseDown={closeDialog}>
          <section
            className="dialog-panel stack"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dialog-title"
            onMouseDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === 'Escape') closeDialog()
            }}
          >
            <div className="section-heading">
              <p className="eyebrow">示例弹层</p>
              <h2 id="dialog-title">保留当前操作上下文</h2>
            </div>
            <p>关闭后焦点会返回到触发按钮。</p>
            <div className="cluster cluster--end">
              <button className="button button--quiet" onClick={closeDialog}>
                取消
              </button>
              <button className="button button--primary" onClick={closeDialog} autoFocus>
                确认
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </PageFrame>
  )
}
