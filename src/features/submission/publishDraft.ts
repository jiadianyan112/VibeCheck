import { normalizeSubmissionUrl, type CompactSubmissionSnapshot, type RemoteSubmissionDraft } from '../../services/submissionApi'
import type { ProjectCategoryId } from '../../types'

export interface PublishFields {
  name: string
  url: string
  summary: string
  category: ProjectCategoryId | ''
  description: string
  repository: string
  technologies: string
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
export const emptyPublishFields: PublishFields = { name: '', url: '', summary: '', category: '', description: '', repository: '', technologies: '' }

export function publishSnapshot(fields: PublishFields, publicUrl: string, references: readonly string[] = [], existing?: Readonly<Record<string, unknown>>): CompactSubmissionSnapshot {
  if (!fields.category) throw new Error('请选择作品分类。')
  if (existing?.category_id && existing.category_id !== fields.category) throw new Error('作品分类已变化，请保存为新的草稿。')
  return {
    category_id: fields.category,
    category_schema_version: fields.category === 'ai_learning_quiz' ? 'learning.v1' : 'portfolio.v1',
    project_core: {
      current_name: fields.name.trim(), public_url: publicUrl, one_line_definition: fields.summary.trim(),
      repository_url: fields.repository.trim() ? normalizeSubmissionUrl(fields.repository.trim()) : null,
      tech_stack: [...new Set(fields.technologies.split(/[,，、\n]/).map(value => value.trim()).filter(Boolean))],
      cover_media_reference_ids: references,
    },
    // The API deep-merges this patch. Unexposed category facts stay intact;
    // an explicitly emptied editable description must clear its previous value.
    category_data: fields.category === 'ai_learning_quiz' ? { core_problem: fields.description.trim() } : {},
  }
}

export function publishFieldsFromRemote(draft: RemoteSubmissionDraft): PublishFields {
  const core = draft.payload_snapshot.project_core as Record<string, unknown> | undefined
  return {
    name: draft.fields.currentName ?? '', url: draft.fields.publicUrl ?? '', summary: draft.fields.oneLineDefinition ?? '', category: draft.category_id,
    description: draft.fields.coreProblem ?? '', repository: draft.fields.repositoryUrl ?? '',
    technologies: Array.isArray(core?.tech_stack) ? core.tech_stack.join('、') : '',
  }
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
