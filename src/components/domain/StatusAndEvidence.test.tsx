import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { accessStatuses, completenessLevels, disputeStatuses, freshnessStatuses } from '../../types'
import { evidences } from '../../mocks'
import { reusableAssets } from '../../mocks'
import { AccessStatusBadge, AssetCard, CompletenessLabel, DisputeNotice, EvidenceDrawer, FreshnessLabel, UnknownFact } from '.'

describe('domain status and evidence components', () => {
  it('renders every access status without collapsing unknown', () => {
    render(<>{accessStatuses.map((status) => <AccessStatusBadge key={status} status={status} />)}</>)
    expect(screen.getByText('正常可访问')).toBeInTheDocument()
    expect(screen.getByText('已暂停')).toBeInTheDocument()
    expect(screen.getByText('已结束')).toBeInTheDocument()
    expect(screen.getByText('未知')).toBeInTheDocument()
  })

  it('renders all freshness and completeness states', () => {
    render(<>{freshnessStatuses.map((status) => <FreshnessLabel key={status} status={status} lastVerifiedAt={null} />)}{completenessLevels.map((level) => <CompletenessLabel key={level} level={level} />)}</>)
    expect(screen.getAllByText('核验时间未知')).toHaveLength(3)
    expect(screen.getByText('资料存在争议')).toBeInTheDocument()
  })

  it('only shows notices for non-empty dispute states', () => {
    const { container } = render(<>{disputeStatuses.map((status) => <DisputeNotice key={status} status={status} />)}</>)
    expect(container.querySelectorAll('[aria-label="争议提示"]')).toHaveLength(3)
  })

  it('opens evidence details with source and verified time', async () => {
    const user = userEvent.setup()
    render(<EvidenceDrawer evidences={[evidences[0]!]} />)
    await user.click(screen.getByRole('button', { name: '查看来源（1）' }))
    expect(screen.getByRole('dialog', { name: '事实来源与核验记录' })).toBeInTheDocument()
    expect(screen.getByText('平台直接核验')).toBeInTheDocument()
    expect(screen.getByText(/核验于/)).toBeInTheDocument()
  })

  it('renders unknown reason and asset metadata', () => {
    render(<><UnknownFact reason="作者尚未提供" /><AssetCard asset={reusableAssets[0]!} projectName="题练工坊" /></>)
    expect(screen.getByText('未知：作者尚未提供')).toBeInTheDocument()
    expect(screen.getByText('MIT')).toBeInTheDocument()
    expect(screen.getByText('免费')).toBeInTheDocument()
  })

  it('requires confirmation before opening an external asset', async () => {
    const user = userEvent.setup()
    render(<AssetCard asset={reusableAssets[0]!} />)
    await user.click(screen.getByRole('button', { name: /查看资产/ }))
    expect(screen.getByRole('dialog', { name: '即将离开 VibeCheck' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '继续访问' })).toHaveAttribute('rel', 'noreferrer')
  })
})
