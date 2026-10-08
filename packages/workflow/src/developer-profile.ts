import { workflowError } from './errors.js'
import type { NewCreatorProfileInput } from './verification-request-types.js'

export function parseDeveloperProfile(value: unknown): NewCreatorProfileInput {
  const invalid = () => workflowError('NEW_CREATOR_PROFILE_INVALID', 422)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid()
  const input = value as Record<string, unknown>
  if (Object.keys(input).some(key => !['display_name', 'bio', 'kind', 'avatar_url', 'website_url'].includes(key)) || typeof input.display_name !== 'string') throw invalid()
  const displayName = input.display_name.trim()
  if (!displayName || displayName.length > 80 || (input.bio !== undefined && (typeof input.bio !== 'string' || input.bio.length > 1000))) throw invalid()
  if (input.kind !== undefined && input.kind !== 'individual' && input.kind !== 'team') throw invalid()
  const url = (value: unknown) => {
    if (value === null) return null
    if (typeof value !== 'string' || value.length > 2048) throw invalid()
    try {
      const parsed = new URL(value)
      if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname.includes('.') || parsed.username || parsed.password) throw invalid()
    } catch { throw invalid() }
    return value.trim()
  }
  return Object.freeze({ display_name: displayName,
    ...(input.bio === undefined ? {} : { bio: (input.bio as string).trim() }),
    ...(input.kind === undefined ? {} : { kind: input.kind as 'individual' | 'team' }),
    ...(input.avatar_url === undefined ? {} : { avatar_url: url(input.avatar_url) }),
    ...(input.website_url === undefined ? {} : { website_url: url(input.website_url) }),
  })
}
