import type { AssetAvailabilityStatus, AssetType, PriceType, ReusableAsset } from '../../types'
import { Card, Tag } from '../ui'
import { ExternalLinkGuard } from './ExternalLinkGuard'

const assetTypeLabels: Record<AssetType, string> = {
  source_code: '源代码', template: '模板', component: '组件', prompt: '提示词',
  parsing_solution: '解析方案', open_api: '开放 API', deployment_solution: '部署方案', other: '其他',
}
const availabilityLabels: Record<AssetAvailabilityStatus, string> = {
  available: '可获取', login_required: '登录后获取', link_abnormal: '链接异常', removed: '已移除', unknown: '状态未知',
}
const priceLabels: Record<PriceType, string> = { free: '免费', paid: '付费', contact: '联系作者', unknown: '价格未知' }

export function AssetCard({ asset, projectName }: { asset: ReusableAsset; projectName?: string }) {
  const price = asset.price.type === 'paid' && asset.price.amount
    ? `${asset.price.amount} ${asset.price.currency ?? ''}`.trim()
    : priceLabels[asset.price.type]
  return (
    <Card className="asset-card stack stack--small">
      <div className="cluster cluster--between"><Tag>{assetTypeLabels[asset.type]}</Tag><Tag tone={asset.availabilityStatus === 'available' ? 'default' : 'dashed'}>{availabilityLabels[asset.availabilityStatus]}</Tag></div>
      <h3>{asset.name}</h3>
      {projectName ? <p className="page-description">来自作品：{projectName}</p> : null}
      <p>{asset.description}</p>
      <dl className="asset-meta"><div><dt>许可</dt><dd>{asset.license ?? '未知'}</dd></div><div><dt>价格</dt><dd>{price}</dd></div><div><dt>最后核验</dt><dd>{asset.lastVerifiedAt ? new Date(asset.lastVerifiedAt).toLocaleDateString('zh-CN') : '未知'}</dd></div></dl>
      {asset.availabilityStatus === 'removed' ? <span className="unknown-value">该资产已移除，保留历史记录。</span> : <ExternalLinkGuard href={asset.url}>查看资产</ExternalLinkGuard>}
    </Card>
  )
}

export { assetTypeLabels, availabilityLabels, priceLabels }
