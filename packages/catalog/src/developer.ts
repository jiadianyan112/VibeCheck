import type { DeclaredDeveloper, DeveloperProjection } from './types.js'

function web(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && url.hostname.includes('.') && !url.username && !url.password ? value : null
  } catch { return null }
}

/** Public identity is verified for this project, never by a global profile badge. */
export function resolveProjectDeveloper(value: unknown, declared: DeclaredDeveloper | undefined, authorLinkStatus: string): DeveloperProjection | null {
  const record = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
  if (record && ['active', 'suspended'].includes(String(record.relation_status)) && record.creator_status !== 'merged' && typeof record.display_name === 'string' && record.display_name.trim()) {
    const disputed = record.relation_status === 'suspended' || record.creator_status === 'disputed' || authorLinkStatus === 'disputed'
    const verified = !disputed && record.relation_status === 'active' && record.link_status === 'active' && record.link_role === 'owner' && record.verification_status === 'verified' && record.creator_status === 'canonical'
    return Object.freeze({
      kind: record.kind === 'individual' || record.kind === 'team' ? record.kind : null,
      display_name: record.display_name.trim(), avatar_url: web(record.avatar_url), website_url: web(record.website_url),
      creator_id: typeof record.creator_id === 'string' ? record.creator_id : null,
      verification_status: disputed ? 'disputed' : verified ? 'verified' : 'unverified',
    })
  }
  if (!declared) return null
  return Object.freeze({ kind: declared.kind, display_name: declared.displayName, avatar_url: declared.avatarUrl ?? null, website_url: declared.websiteUrl ?? null, creator_id: null, verification_status: authorLinkStatus === 'disputed' ? 'disputed' : 'unverified' })
}
