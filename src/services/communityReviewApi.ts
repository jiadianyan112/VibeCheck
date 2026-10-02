import type { AuthSessionDto } from './authService'

export interface CommunityWorkItem {
  readonly work_item_id: string
  readonly target_id: string
  readonly version: number
  readonly assignee_user_id: string | null
  readonly work_item_status: string
  readonly lease_expires_at: string | null
  readonly domain_summary: {
    readonly status: string
    readonly version?: number
    readonly entry_type?: string
    readonly body?: string
    readonly experience_task?: string | null
    readonly project_id?: string
    readonly experience_scenario?: string | null
    readonly experience_limitation?: string | null
    readonly screenshot_media_resource_ids?: readonly string[]
  }
  readonly created_at: string
}

const apiBase = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')

export const communityReviewApi = {
  async list(userId?: string): Promise<readonly CommunityWorkItem[]> {
    const result: CommunityWorkItem[] = []
    for (const status of userId ? ['queued', 'claimed'] : ['queued']) {
    let cursor: string | null = null
    do {
      const params = new URLSearchParams({ work_type: 'community', target_type: 'comment', status })
      if (cursor) params.set('cursor', cursor)
      const response = await fetch(`${apiBase}/api/v1/admin/work-items?${params}`, { credentials: 'include' })
      if (!response.ok) throw new Error(`队列读取失败（${response.status}）`)
      const page = await response.json() as { items: CommunityWorkItem[]; next_cursor: string | null }
      result.push(...page.items.filter((item) => status !== 'claimed' || item.assignee_user_id === userId))
      cursor = page.next_cursor
    } while (cursor)
    }
    return result
  },
  async claim(item: CommunityWorkItem, session: AuthSessionDto): Promise<string> {
    const response = await fetch(`${apiBase}/api/v1/admin/work-items/${item.work_item_id}/claim`, {
      method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json', 'x-csrf-token': session.csrf_token },
      body: JSON.stringify({ expected_version: item.version }),
    })
    if (!response.ok) throw new Error(`领取失败（${response.status}），请刷新队列。`)
    const claimed = await response.json() as { claim_token: string }
    return claimed.claim_token
  },
  screenshotUrl(experienceId: string, mediaId: string) { return `${apiBase}/api/v1/admin/experiences/${experienceId}/screenshots/${mediaId}/content` },
  async heartbeat(workItemId: string, claimToken: string, session: AuthSessionDto): Promise<void> {
    const response = await fetch(`${apiBase}/api/v1/admin/work-items/${workItemId}/heartbeat`, {
      method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json', 'x-csrf-token': session.csrf_token },
      body: JSON.stringify({ claim_token: claimToken }),
    })
    if (!response.ok) throw new Error('审核领取已失效，请重新领取。')
  },
  async decide(item: CommunityWorkItem, session: AuthSessionDto, resultingState: 'visible' | 'hidden', reasonCode: string, claimToken: string): Promise<void> {
    const response = await fetch(`${apiBase}/api/v1/admin/community/comments/${encodeURIComponent(item.target_id)}/decision`, {
      method: 'POST', credentials: 'include',
      headers: { 'content-type': 'application/json', 'x-csrf-token': session.csrf_token },
      body: JSON.stringify({
        expected_version: item.domain_summary.version,
        resulting_state: resultingState === 'hidden' && item.domain_summary.status === 'pending' ? 'rejected' : resultingState, decision_id: crypto.randomUUID(), reason_code: reasonCode,
        work_item_id: item.work_item_id, claim_token: claimToken,
      }),
    })
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { error?: { code?: string } } | null
      throw new Error(`审核失败（${payload?.error?.code ?? response.status}）`)
    }
  },
}
