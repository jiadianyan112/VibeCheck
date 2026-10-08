export type CreatorKind = 'individual' | 'team' | null
export type CreatorVerificationStatus = 'unverified' | 'verified' | 'disputed'

export interface CreatorProjectionDto {
  readonly creator_id: string
  readonly display_name: string
  readonly kind?: CreatorKind
  readonly avatar_url: string | null
  readonly website_url?: string | null
  readonly verification_status: CreatorVerificationStatus
  readonly bio: string
  readonly contacts: readonly Readonly<Record<string, string>>[]
  readonly published_project_ids: readonly string[]
  readonly read_version: number
}

export class CreatorApiError extends Error {
  constructor(readonly status: number, readonly code = 'CREATOR_REQUEST_FAILED') {
    super(code)
    this.name = 'CreatorApiError'
  }
}

const apiBase = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')

export const creatorApi = {
  async get(id: string, signal?: AbortSignal): Promise<CreatorProjectionDto> {
    let response: Response
    try {
      response = await fetch(`${apiBase}/api/v1/creators/${encodeURIComponent(id)}`, {
        method: 'GET', credentials: 'include', cache: 'no-store', signal,
        headers: { accept: 'application/json' },
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error
      throw new CreatorApiError(0, 'NETWORK_UNAVAILABLE')
    }
    if (!response.ok) throw new CreatorApiError(response.status, response.status === 404 ? 'CREATOR_NOT_FOUND' : 'CREATOR_REQUEST_FAILED')
    try {
      return await response.json() as CreatorProjectionDto
    } catch {
      throw new CreatorApiError(response.status, 'CREATOR_INVALID_RESPONSE')
    }
  },
}
