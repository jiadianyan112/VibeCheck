import type { PublicationDetails, SubmitterRelation } from '../../types'

export const submitterRelationLabels: Record<SubmitterRelation, string> = { owner: '所有者', team_member: '团队成员', third_party: '第三方推荐者' }

export function publicationWebUrl(value: unknown, video = false): boolean {
  if (typeof value !== 'string' || value.length > 2048) return false
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && url.hostname.includes('.') && !url.username && !url.password &&
      (!video || (url.protocol === 'https:' && ['bilibili.com', 'b23.tv'].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))))
  } catch { return false }
}

/** Read optional metadata at the JSON boundary; missing legacy data stays missing. */
export function readPublicationDetails(value: unknown, partial = false): PublicationDetails | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const data = value as Record<string, unknown>
  const allowed = ['submitterRelation', 'organizationName', 'detailedDescription', 'logoUrl', 'galleryUrls', 'videoUrl', 'acknowledgements']
  if (Object.keys(data).some(key => !allowed.includes(key))) return undefined
  const details: PublicationDetails = {}
  if (data.submitterRelation !== undefined) {
    if (!['owner', 'team_member', 'third_party'].includes(data.submitterRelation as string)) return undefined
    details.submitterRelation = data.submitterRelation as SubmitterRelation
  }
  for (const [key, max] of [['organizationName', 120], ['detailedDescription', 10000]] as const) {
    if (data[key] !== undefined) {
      if (typeof data[key] !== 'string' || data[key].length > max) return undefined
      details[key] = data[key]
    }
  }
  for (const key of ['logoUrl', 'videoUrl'] as const) {
    if (data[key] !== undefined) {
      if (data[key] !== null && (typeof data[key] !== 'string' || data[key].length > 2048 || (!partial && !publicationWebUrl(data[key], key === 'videoUrl')))) return undefined
      details[key] = data[key] as string | null
    }
  }
  if (data.galleryUrls !== undefined) {
    if (!Array.isArray(data.galleryUrls) || data.galleryUrls.length > 20 || !data.galleryUrls.every(url => typeof url === 'string' && url.length <= 2048 && (partial || publicationWebUrl(url)))) return undefined
    details.galleryUrls = [...data.galleryUrls] as string[]
  }
  if (data.acknowledgements !== undefined) {
    if (!Array.isArray(data.acknowledgements) || data.acknowledgements.length > 20) return undefined
    const items = []
    for (const item of data.acknowledgements) {
      if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some(key => !['name', 'url', 'note'].includes(key))) return undefined
      if (typeof item.name !== 'string' || (!partial && !item.name.trim()) || item.name.length > 120 || typeof item.note !== 'string' || (!partial && !item.note.trim()) || item.note.length > 2000 || typeof item.url !== 'string' || item.url.length > 2048 || (!partial && item.url !== '' && !publicationWebUrl(item.url))) return undefined
      items.push({ name: item.name, url: item.url, note: item.note })
    }
    details.acknowledgements = items
  }
  return details
}
