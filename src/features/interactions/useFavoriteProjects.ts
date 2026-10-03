import { useCallback, useEffect, useRef, useState } from 'react'
import { interactionApi } from '../../services/interactionApi'
import { projectService } from '../../services/projectService'
import type { Project } from '../../types'
import { useAuthSession } from '../auth/AuthSessionContext'
import { useInteractionCollectionVersion } from './ProjectInteractionContext'

export function useFavoriteProjects() {
  const { session } = useAuthSession()
  const userId = session?.user_id ?? null
  const collectionVersion = useInteractionCollectionVersion()
  const [page, setPage] = useState<{ owner: string | null; projects: Project[]; cursor: string | null }>({ owner: null, projects: [], cursor: null })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const owner = useRef(userId)
  owner.current = userId
  const requestVersion = useRef(0)
  const controller = useRef<AbortController | null>(null)
  const read = useCallback(async (cursor: string | null = null) => {
    if (!import.meta.env.PROD || !userId) return
    controller.current?.abort()
    const abort = new AbortController()
    controller.current = abort
    const version = ++requestVersion.current
    setLoading(true)
    setError(null)
    try {
      const result = await interactionApi.favorites(cursor, abort.signal)
      const loaded = await Promise.all(result.items.map(async item => {
        const response = await projectService.getById(item.project_id as Project['id'], { signal: abort.signal })
        if (response.ok) return response.data
        if (response.error.kind === 'not_found') return null
        throw new Error(response.error.code)
      }))
      if (version !== requestVersion.current || owner.current !== userId) return
      const projects = loaded.filter((project): project is Project => project !== null)
      setPage(previous => ({
        owner: userId,
        projects: cursor && previous.owner === userId ? [...previous.projects, ...projects.filter(project => !previous.projects.some(old => old.id === project.id))] : projects,
        cursor: result.next_cursor,
      }))
    } catch {
      if (version === requestVersion.current && owner.current === userId) setError('收藏暂时无法加载，请重试。')
    } finally {
      if (version === requestVersion.current && owner.current === userId) setLoading(false)
    }
  }, [userId])
  useEffect(() => {
    ++requestVersion.current
    setError(null)
    setPage(previous => previous.owner === userId ? previous : { owner: userId, projects: [], cursor: null })
    setLoading(false)
    void read()
    const refresh = () => { if (document.visibilityState !== 'hidden') void read() }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    const timer = window.setInterval(refresh, 30_000)
    return () => {
      // Invalidate all reads started in this effect, including pagination.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      ++requestVersion.current
      controller.current?.abort()
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [userId, collectionVersion, read])
  return {
    projects: page.owner === userId ? page.projects : [],
    nextCursor: page.owner === userId ? page.cursor : null,
    loading, error, refresh: read,
    loadMore: async () => { if (!loading && page.owner === userId && page.cursor) await read(page.cursor) },
  }
}
