import { ExternalLinkGuard } from '../../components/domain/ExternalLinkGuard'
import type { PublicationDetails } from '../../types'
import { submitterRelationLabels } from './publicationDetails'

// Old local drafts can predate URL validation. Only render web links here.
function webUrl(value: string | null | undefined) {
  if (!value) return null
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null
  } catch { return null }
}

function MediaAddress({ label, url }: { label: string; url: string }) {
  const safe = webUrl(url)
  return <li>{safe ? <ExternalLinkGuard href={safe}>{label}</ExternalLinkGuard> : <span>{label}：地址需要修正</span>}<small className="publication-address">{url}</small></li>
}

export function PublicationSummary({ fields, coverUrl, showEmpty = false }: { fields: PublicationDetails; coverUrl?: string | null; showEmpty?: boolean }) {
  const hasDetails = fields.submitterRelation || fields.organizationName || fields.detailedDescription || fields.logoUrl || fields.galleryUrls?.length || fields.videoUrl || fields.acknowledgements?.length || coverUrl
  if (!hasDetails && !showEmpty) return null
  return <section className="publication-summary stack" aria-label="发布介绍与致谢">
    <dl className="submission-summary-grid">
      <div><dt>提交者关系（自述）</dt><dd>{fields.submitterRelation ? submitterRelationLabels[fields.submitterRelation] ?? '未说明' : '未说明'}</dd></div>
      <div><dt>所属团队或开发者</dt><dd>{fields.organizationName?.trim() || '未填写'}</dd></div>
    </dl>
    <p className="page-description">提交者关系不代表已验证的作者身份。</p>
    {fields.detailedDescription ? <div><h3>详细介绍</h3><p className="publication-prose">{fields.detailedDescription}</p></div> : showEmpty ? <p>详细介绍未填写，可稍后补充。</p> : null}
    {fields.logoUrl || coverUrl || fields.galleryUrls?.length || fields.videoUrl ? <div><h3>产品图集与视频</h3><ul className="publication-media-list">
      {fields.logoUrl ? <MediaAddress label="查看 Logo" url={fields.logoUrl} /> : null}
      {coverUrl ? <MediaAddress label="查看作品封面" url={coverUrl} /> : null}
      {(fields.galleryUrls ?? []).map((url, index) => <MediaAddress key={`${index}-${url}`} label={`查看详情图 ${index + 1}`} url={url} />)}
      {fields.videoUrl ? <MediaAddress label="观看产品视频" url={fields.videoUrl} /> : null}
    </ul></div> : null}
    {fields.acknowledgements?.length ? <div><h3>致谢产品与工具</h3><ul className="publication-thanks-list">{fields.acknowledgements.map((item, index) => <li key={`${index}-${item.name}`}>
      <strong>{item.name}</strong><p className="publication-prose">{item.note}</p>{webUrl(item.url) ? <ExternalLinkGuard href={webUrl(item.url)!}>访问 {item.name}</ExternalLinkGuard> : null}
    </li>)}</ul></div> : showEmpty ? <p>未添加致谢。</p> : null}
  </section>
}
