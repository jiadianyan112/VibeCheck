import { normalizeSubmissionUrl, type CompactSubmissionSnapshot, type RemoteSubmissionDraft } from '../../services/submissionApi'
import { publicationWebUrl } from './publicationDetails'
import type { ProjectCategoryId, SubmissionAcknowledgement, SubmitterRelation as DomainSubmitterRelation } from '../../types'

export type SubmitterRelation = DomainSubmitterRelation | ''
export type DeveloperKind = 'individual' | 'team'

export type PublishAcknowledgement = SubmissionAcknowledgement

export interface PublishFields {
  name: string
  url: string
  summary: string
  category: ProjectCategoryId | ''
  description: string
  repository: string
  technologies: string
  submitterRelation: SubmitterRelation
  organizationName: string
  /** The current publication subject. Legacy relation fields stay readable for old drafts. */
  developerKind: DeveloperKind | ''
  developerName: string
  developerAvatarUrl: string
  developerWebsiteUrl: string
  detailedDescription: string
  logoUrl: string
  galleryUrls: string[]
  videoUrl: string
  acknowledgements: PublishAcknowledgement[]
}
export interface PublishImage {
  id: string
  file: File
  resourceId?: string
  referenceId?: string
  referenceDraftId?: string
  referenceOrder?: number
  error?: string
}
export interface PublishSavedDraft {
  fields: PublishFields
  images: PublishImage[]
  remoteId?: string
  ownerId?: string
  submissionKey?: string
  submittedId?: string
  pendingSubmission?: {
    draftId: string
    draftVersion: number
    checkId: string
    previewHash: string
    submissionKey: string
  }
}
export const emptyPublishFields: PublishFields = {
  name: '', url: '', summary: '', category: '', description: '', repository: '', technologies: '',
  submitterRelation: '', organizationName: '', developerKind: '', developerName: '', developerAvatarUrl: '', developerWebsiteUrl: '',
  detailedDescription: '', logoUrl: '', galleryUrls: [], videoUrl: '', acknowledgements: [],
}

/** Merge persisted drafts with the current shape so pre-feature IndexedDB records remain editable. */
export function mergePublishFields(value: Partial<PublishFields> | null | undefined): PublishFields {
  const source = value ?? {}
  return {
    ...emptyPublishFields,
    name: typeof source.name === 'string' ? source.name : '',
    url: typeof source.url === 'string' ? source.url : '',
    summary: typeof source.summary === 'string' ? source.summary : '',
    category: source.category === 'ai_learning_quiz' || source.category === 'personal_site_portfolio' ? source.category : '',
    description: typeof source.description === 'string' ? source.description : '',
    repository: typeof source.repository === 'string' ? source.repository : '',
    technologies: typeof source.technologies === 'string' ? source.technologies : '',
    submitterRelation: source.submitterRelation === 'owner' || source.submitterRelation === 'team_member' || source.submitterRelation === 'third_party' ? source.submitterRelation : '',
    organizationName: typeof source.organizationName === 'string' ? source.organizationName : '',
    developerKind: source.developerKind === 'individual' || source.developerKind === 'team' ? source.developerKind : '',
    developerName: typeof source.developerName === 'string' ? source.developerName : '',
    developerAvatarUrl: typeof source.developerAvatarUrl === 'string' ? source.developerAvatarUrl : '',
    developerWebsiteUrl: typeof source.developerWebsiteUrl === 'string' ? source.developerWebsiteUrl : '',
    detailedDescription: typeof source.detailedDescription === 'string' ? source.detailedDescription : '',
    logoUrl: typeof source.logoUrl === 'string' ? source.logoUrl : '',
    galleryUrls: Array.isArray(source.galleryUrls) ? source.galleryUrls.filter((item): item is string => typeof item === 'string') : [],
    videoUrl: typeof source.videoUrl === 'string' ? source.videoUrl : '',
    acknowledgements: Array.isArray(source.acknowledgements)
      ? source.acknowledgements.map(item => ({
        name: typeof item?.name === 'string' ? item.name : '',
        url: typeof item?.url === 'string' ? item.url : '',
        note: typeof item?.note === 'string' ? item.note : '',
      }))
      : [],
  }
}

export type PublishFieldErrors = Partial<Record<keyof PublishFields, string>>

interface RemoteDeveloperPayload {
  readonly kind?: unknown
  readonly displayName?: unknown
  readonly avatarUrl?: unknown
  readonly websiteUrl?: unknown
}

function validHttpUrl(value: string): boolean {
  try { normalizeSubmissionUrl(value.trim()); return true } catch { return false }
}

/** Shared submit-time validation. Draft persistence intentionally does not call this. */
export function validatePublishFields(fields: PublishFields): PublishFieldErrors {
  const errors: PublishFieldErrors = {}
  if (!fields.name.trim()) errors.name = '请填写作品名称'
  else if (fields.name.length > 80) errors.name = '作品名称不能超过 80 个字符'
  if (!fields.summary.trim()) errors.summary = '请填写一句话介绍'
  else if (fields.summary.length > 80) errors.summary = '一句话介绍不能超过 80 个字符'
  if (!fields.category) errors.category = '请选择作品分类'
  if (!['individual', 'team'].includes(fields.developerKind)) errors.developerKind = '请选择开发主体类型'
  if (!fields.developerName.trim()) errors.developerName = '请填写开发者或团队名称'
  else if (fields.developerName.trim().length > 80) errors.developerName = '开发者或团队名称不能超过 80 个字符'
  if (!fields.url.trim() || !validHttpUrl(fields.url)) errors.url = '请输入有效的公开链接，例如 example.com'
  if (fields.repository.trim() && !validHttpUrl(fields.repository)) errors.repository = '请输入有效的代码仓库链接'
  if (fields.description.length > 500) errors.description = '解决的问题不能超过 500 个字符'
  if (fields.organizationName.length > 120) errors.organizationName = '团队或组织名称不能超过 120 个字符'
  if (fields.developerAvatarUrl.trim() && !publicationWebUrl(fields.developerAvatarUrl.trim())) errors.developerAvatarUrl = '请输入有效的头像或 Logo 链接'
  if (fields.developerWebsiteUrl.trim() && !publicationWebUrl(fields.developerWebsiteUrl.trim())) errors.developerWebsiteUrl = '请输入有效的官网链接'
  if (fields.detailedDescription.length > 10000) errors.detailedDescription = '详细介绍不能超过 10000 个字符'
  if (fields.logoUrl.trim() && !publicationWebUrl(fields.logoUrl.trim())) errors.logoUrl = '请输入有效的 Logo 链接'
  if (fields.galleryUrls.length > 20) errors.galleryUrls = '详情图地址最多填写 20 条'
  if (new Set(fields.galleryUrls.map(url => url.trim())).size !== fields.galleryUrls.length) errors.galleryUrls = '详情图地址不能重复'
  fields.galleryUrls.forEach((url, index) => {
    if (!publicationWebUrl(url.trim())) errors.galleryUrls = `第 ${index + 1} 张详情图链接无效`
  })
  if (fields.videoUrl.trim() && !publicationWebUrl(fields.videoUrl.trim(), true)) errors.videoUrl = '请输入 HTTPS 的 bilibili 或 b23.tv 视频链接'
  if (fields.acknowledgements.length > 20) errors.acknowledgements = '致谢最多填写 20 条'
  fields.acknowledgements.forEach((item, index) => {
    if (!item.name.trim() || !item.note.trim()) errors.acknowledgements = `第 ${index + 1} 条致谢需要填写名称和说明`
    else if (item.name.length > 120 || item.note.length > 2000) errors.acknowledgements = `第 ${index + 1} 条致谢超出长度限制`
    else if (item.url.trim() && !publicationWebUrl(item.url.trim())) errors.acknowledgements = `第 ${index + 1} 条致谢链接无效`
  })
  return errors
}

function publicationDetailsFromFields(fields: PublishFields) {
  const legacy = {
    ...(fields.submitterRelation ? { submitterRelation: fields.submitterRelation } : {}),
    organizationName: fields.organizationName.trim(),
    detailedDescription: fields.detailedDescription.trim(),
    logoUrl: fields.logoUrl.trim() || null,
    galleryUrls: fields.galleryUrls.map(value => value.trim()).filter(Boolean),
    videoUrl: fields.videoUrl.trim() || null,
    acknowledgements: fields.acknowledgements.map(item => ({ name: item.name.trim(), url: item.url.trim(), note: item.note.trim() })),
  }
  const hasDeveloper = Boolean(fields.developerKind && fields.developerName.trim())
  if (!hasDeveloper) return legacy
  return {
    ...legacy,
    // New submissions always identify the publishing account as owner. The old
    // self-reported relation is kept only for legacy drafts and snapshots.
    submitterRelation: 'owner' as const,
    developer: {
      kind: fields.developerKind as DeveloperKind,
      displayName: fields.developerName.trim(),
      ...(fields.developerAvatarUrl.trim() ? { avatarUrl: fields.developerAvatarUrl.trim() } : {}),
      ...(fields.developerWebsiteUrl.trim() ? { websiteUrl: fields.developerWebsiteUrl.trim() } : {}),
    },
  }
}

export function publishSnapshot(fields: PublishFields, publicUrl: string, references: readonly string[] = [], existing?: Readonly<Record<string, unknown>>): CompactSubmissionSnapshot {
  if (!fields.category) throw new Error('请选择作品分类。')
  if (existing?.category_id && existing.category_id !== fields.category) throw new Error('作品分类已变化，请保存为新的草稿。')
  const projectCore = {
    current_name: fields.name.trim(), public_url: publicUrl, one_line_definition: fields.summary.trim(),
    repository_url: fields.repository.trim() ? normalizeSubmissionUrl(fields.repository.trim()) : null,
    tech_stack: [...new Set(fields.technologies.split(/[,，、\n]/).map(value => value.trim()).filter(Boolean))],
    cover_media_reference_ids: references,
    publication_details: publicationDetailsFromFields(fields),
  }
  return {
    category_id: fields.category,
    category_schema_version: fields.category === 'ai_learning_quiz' ? 'learning.v1' : 'portfolio.v1',
    project_core: projectCore as CompactSubmissionSnapshot['project_core'],
    // The API deep-merges this patch. Unexposed category facts stay intact;
    // an explicitly emptied editable description must clear its previous value.
    category_data: fields.category === 'ai_learning_quiz' ? { core_problem: fields.description.trim() } : {},
  }
}

export function publishFieldsFromRemote(draft: RemoteSubmissionDraft): PublishFields {
  const core = draft.payload_snapshot.project_core as Record<string, unknown> | undefined
  const publication = (core?.publication_details && typeof core.publication_details === 'object' ? core.publication_details : {}) as Partial<PublishFields> & { developer?: RemoteDeveloperPayload }
  const serverFields = draft.fields as Partial<PublishFields>
  return mergePublishFields({
    name: draft.fields.currentName ?? '', url: draft.fields.publicUrl ?? '', summary: draft.fields.oneLineDefinition ?? '', category: draft.category_id,
    description: draft.fields.coreProblem ?? '', repository: draft.fields.repositoryUrl ?? '',
    technologies: Array.isArray(core?.tech_stack) ? core.tech_stack.join('、') : '',
     submitterRelation: serverFields.submitterRelation ?? publication.submitterRelation ?? '',
    organizationName: serverFields.organizationName ?? publication.organizationName ?? '',
     developerKind: serverFields.developerKind ?? (publication.developer?.kind === 'individual' || publication.developer?.kind === 'team' ? publication.developer.kind : ''),
     developerName: serverFields.developerName ?? (typeof publication.developer?.displayName === 'string' ? publication.developer.displayName : ''),
     developerAvatarUrl: serverFields.developerAvatarUrl ?? (typeof publication.developer?.avatarUrl === 'string' ? publication.developer.avatarUrl : ''),
     developerWebsiteUrl: serverFields.developerWebsiteUrl ?? (typeof publication.developer?.websiteUrl === 'string' ? publication.developer.websiteUrl : ''),
    detailedDescription: serverFields.detailedDescription ?? publication.detailedDescription ?? '',
    logoUrl: serverFields.logoUrl ?? publication.logoUrl ?? '',
    galleryUrls: serverFields.galleryUrls ?? publication.galleryUrls ?? [],
    videoUrl: serverFields.videoUrl ?? publication.videoUrl ?? '',
    acknowledgements: serverFields.acknowledgements ?? publication.acknowledgements ?? [],
  })
}

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('vibecheck-publish', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('drafts')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function readPublishDraft(key: string): Promise<PublishSavedDraft | undefined> {
  const db = await database()
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('drafts').objectStore('drafts').get(key)
      request.onsuccess = () => resolve(request.result as PublishSavedDraft | undefined)
      request.onerror = () => reject(request.error)
    })
  } finally { db.close() }
}

export async function savePublishDraft(key: string, draft: PublishSavedDraft): Promise<void> {
  const db = await database()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('drafts', 'readwrite')
      transaction.objectStore('drafts').put(draft, key)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
  } finally { db.close() }
}

/** Crop only the user-selected image; original files remain until the user applies. */
export async function cropPublishImage(file: File, ratio: number): Promise<File> {
  const bitmap = await createImageBitmap(file)
  try {
    const width = Math.min(bitmap.width, bitmap.height * ratio)
    const height = width / ratio
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(width)
    canvas.height = Math.round(height)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('当前浏览器无法裁剪图片。')
    context.drawImage(bitmap, (bitmap.width - width) / 2, (bitmap.height - height) / 2, width, height, 0, 0, width, height)
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('裁剪失败，原图已保留。')), 'image/jpeg', 0.9))
    return new File([blob], `${file.name.replace(/\.[^.]+$/, '')}-crop.jpg`, { type: 'image/jpeg' })
  } finally { bitmap.close() }
}
