import { useState } from 'react'
import {
  Button,
  Card,
  Drawer,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  Modal,
  PageFrame,
  Table,
  Tabs,
  Tag,
  type TableColumn,
} from '../components'

interface StatusRow {
  project: string
  status: string
  source: string
  checkedAt: string
}

const statusRows: StatusRow[] = [
  { project: '题练工坊', status: '正常可访问', source: '平台直接验证', checkedAt: '2026-07-24' },
  { project: '口语回声', status: '信息待验证', source: '已验证作者声明', checkedAt: '2026-06-18' },
]

const columns: TableColumn<StatusRow>[] = [
  { key: 'project', header: '作品', rowHeader: true, render: (row) => row.project },
  { key: 'status', header: '当前状态', render: (row) => row.status },
  { key: 'source', header: '来源', render: (row) => row.source },
  { key: 'checkedAt', header: '最后验证', render: (row) => row.checkedAt },
]

export function StyleSandboxPage() {
  const [modalOpen, setModalOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [tab, setTab] = useState<'normal' | 'error'>('normal')

  return (
    <PageFrame title="低保真组件沙盒" description="T12：所有基础组件、交互状态与窄屏行为的统一验证入口。">
      <div className="sandbox-grid">
        <section className="wire-panel stack" aria-labelledby="sandbox-actions">
          <div className="section-heading"><p className="eyebrow">Controls</p><h2 id="sandbox-actions">操作与输入</h2></div>
          <div className="cluster">
            <Button variant="primary">主要操作</Button><Button>次要操作</Button><Button variant="quiet">文字操作</Button>
            <Button disabled>不可用</Button><Button loading>提交</Button>
          </div>
          <Input label="作品名称或完整想法" placeholder="例如：把 PDF 自动生成练习题" hint="支持作品名、功能词和完整产品想法。" />
          <Input label="错误示例" defaultValue="无效地址" error="请输入完整的 https:// 地址" />
          <div className="cluster" aria-label="状态标签示例"><Tag>正常可访问</Tag><Tag tone="strong">需要登录</Tag><Tag tone="dashed">信息待验证</Tag></div>
        </section>

        <section className="wire-panel stack" aria-labelledby="sandbox-card">
          <div className="section-heading"><p className="eyebrow">Card & Tabs</p><h2 id="sandbox-card">卡片与标签页</h2></div>
          <Tabs label="卡片状态" items={[{ id: 'normal', label: '正常' }, { id: 'error', label: '错误' }]} value={tab} onChange={setTab} />
          <Card className="stack stack--small">
            <div className="media-placeholder">16:9 作品截图</div><strong>题练工坊</strong>
            <p>{tab === 'normal' ? '把学习材料转换为结构化题目。' : '该作品的状态仍需核验。'}</p>
          </Card>
        </section>

        <section className="wire-panel stack span-full" aria-labelledby="sandbox-table">
          <div className="section-heading"><p className="eyebrow">Table</p><h2 id="sandbox-table">对比表与窄屏替代</h2></div>
          <Table label="作品状态对比表" rows={statusRows} columns={columns} getRowKey={(row) => row.project} />
        </section>

        <section className="wire-panel stack" aria-labelledby="sandbox-feedback">
          <div className="section-heading"><p className="eyebrow">Feedback</p><h2 id="sandbox-feedback">加载、空态与错误</h2></div>
          <LoadingState /><EmptyState title="还没有保存的作品" description="从作品广场选择一个项目。" action={<Button>探索作品</Button>} />
          <ErrorState message="模拟服务暂时没有响应。" onRetry={() => undefined} />
        </section>

        <section className="wire-panel stack" aria-labelledby="sandbox-overlays">
          <div className="section-heading"><p className="eyebrow">Overlay</p><h2 id="sandbox-overlays">弹层与抽屉</h2></div>
          <p>支持 Esc、遮罩关闭与焦点返回。</p>
          <div className="cluster"><Button onClick={() => setModalOpen(true)}>打开弹层示例</Button><Button onClick={() => setDrawerOpen(true)}>打开抽屉示例</Button></div>
        </section>
      </div>

      <Modal open={modalOpen} title="保留当前操作上下文" onClose={() => setModalOpen(false)} footer={<Button variant="primary" onClick={() => setModalOpen(false)}>确认</Button>}>
        <p>关闭后焦点会返回到触发按钮。</p>
      </Modal>
      <Drawer open={drawerOpen} title="证据详情" onClose={() => setDrawerOpen(false)}><p>抽屉用于承载不打断主任务的补充信息。</p></Drawer>
    </PageFrame>
  )
}
