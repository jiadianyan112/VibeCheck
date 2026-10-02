import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react'
import { useToast } from '../../components'
import { interactionApi, type InteractionSnapshot } from '../../services/interactionApi'
import { useAppState } from '../../state'
import type { Project } from '../../types'
import { useAuthSession } from '../auth/AuthSessionContext'

interface InteractionContextValue {
  snapshots: Readonly<Record<string, InteractionSnapshot>>
  busy: ReadonlySet<string>
  register: (ids: readonly string[]) => () => void
  toggleLike: (id: string) => Promise<void>
}
const InteractionContext = createContext<InteractionContextValue | null>(null)
const serverId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function ProjectInteractionProvider({ children }: PropsWithChildren) {
  const { session } = useAuthSession()
  const { state } = useAppState()
  const { pushToast } = useToast()
  const [snapshots, setSnapshots] = useState<Record<string, InteractionSnapshot>>({})
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [registrationVersion, setRegistrationVersion] = useState(0)
  const registrations = useRef(new Map<string, number>())
  const snapshotRef = useRef(snapshots)
  const inFlight = useRef(new Set<string>())
  const revisions = useRef(new Map<string, number>())
  const identity = useRef({ userId: session?.user_id ?? null, epoch: 0 })
  if (identity.current.userId !== (session?.user_id ?? null)) {
    identity.current = { userId: session?.user_id ?? null, epoch: identity.current.epoch + 1 }
  }
  const pendingLike = useRef<{ id: string; projectId: string } | null>(null)
  const enabled = import.meta.env.PROD

  const register = useCallback((ids: readonly string[]) => {
    ids.forEach(id => registrations.current.set(id, (registrations.current.get(id) ?? 0) + 1))
    setRegistrationVersion(value => value + 1)
    return () => {
      ids.forEach(id => {
        const count = (registrations.current.get(id) ?? 1) - 1
        if (count) registrations.current.set(id, count)
        else registrations.current.delete(id)
      })
      setRegistrationVersion(value => value + 1)
    }
  }, [])

  useEffect(() => {
    snapshotRef.current = {}
    setSnapshots({})
    inFlight.current.clear()
    setBusy(new Set())
  }, [session?.user_id])

  useEffect(() => {
    if (!enabled || !session) return
    let active = true
    let reading = false
    const ownerEpoch = identity.current.epoch
    const controller = new AbortController()
    const refresh = async () => {
      if (reading || document.visibilityState === 'hidden') return
      const ids = [...registrations.current.keys()]
      if (!ids.length) return
      reading = true
      const readRevisions = new Map(revisions.current)
      try {
        const items = await interactionApi.list(ids, controller.signal)
        if (!active || identity.current.epoch !== ownerEpoch) return
        const next = { ...snapshotRef.current }
        for (const item of items) {
          if (!inFlight.current.has(item.project_id) && readRevisions.get(item.project_id) === revisions.current.get(item.project_id)) next[item.project_id] = item
        }
        snapshotRef.current = next
        setSnapshots(next)
      } catch {
        // Keep the last confirmed state; a failed read never changes a like.
      } finally { reading = false }
    }
    const onVisible = () => { if (document.visibilityState !== 'hidden') void refresh() }
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, 30_000)
    window.addEventListener('focus', onVisible)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      active = false
      controller.abort()
      window.clearInterval(timer)
      window.removeEventListener('focus', onVisible)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [enabled, registrationVersion, session])

  const saveLike = useCallback(async (id: string, desired?: boolean) => {
    if (!session || inFlight.current.has(id)) return
    const ownerEpoch = identity.current.epoch
    inFlight.current.add(id)
    revisions.current.set(id, (revisions.current.get(id) ?? 0) + 1)
    setBusy(new Set(inFlight.current))
    try {
      const current = snapshotRef.current[id] ?? (await interactionApi.list([id])).find(item => item.project_id === id)
      if (!current) throw new Error('PROJECT_UNAVAILABLE')
      if (identity.current.epoch !== ownerEpoch) return
      const saved = await interactionApi.setLike(id, desired ?? !current.states.like, session)
      if (identity.current.epoch !== ownerEpoch) return
      const next = { ...snapshotRef.current, [id]: saved }
      snapshotRef.current = next
      setSnapshots(next)
    } catch {
      if (identity.current.epoch === ownerEpoch) pushToast('点赞未保存，请检查网络后重试。', 'error')
    } finally {
      if (identity.current.epoch === ownerEpoch) {
        inFlight.current.delete(id)
        setBusy(new Set(inFlight.current))
      }
    }
  }, [pushToast, session])
  const toggleLike = useCallback((id: string) => saveLike(id, !(snapshotRef.current[id]?.states.like ?? false)), [saveLike])

  useEffect(() => {
    if (!enabled) return
    const queued = state.pendingAction
    if (queued?.kind === 'like') pendingLike.current = { id: queued.id, projectId: queued.projectId }
    const pending = pendingLike.current
    if (session && pending && state.lastReplayedActionId === pending.id) {
      pendingLike.current = null
      void saveLike(pending.projectId, true)
    }
  }, [enabled, saveLike, session, state.lastReplayedActionId, state.pendingAction])

  const value = useMemo(() => ({ snapshots, busy, register, toggleLike }), [busy, register, snapshots, toggleLike])
  return <InteractionContext.Provider value={value}>{children}</InteractionContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useProjectInteractions(projects: readonly Project[]) {
  const context = useContext(InteractionContext)
  const { state, dispatch } = useAppState()
  const idsKey = projects.filter(project => serverId.test(project.id)).map(project => project.id).sort().join(',')
  const register = context?.register
  useEffect(() => {
    if (!import.meta.env.PROD || !register || !idsKey) return
    return register(idsKey.split(','))
  }, [idsKey, register])
  return {
    liked(project: Project) {
      return import.meta.env.PROD ? context?.snapshots[project.id]?.states.like ?? false : state.likedProjectIds.includes(project.id)
    },
    likeCount(project: Project) {
      return import.meta.env.PROD ? context?.snapshots[project.id]?.counts.like_count ?? project.interactionSummary.likeCount : project.interactionSummary.likeCount + (state.likedProjectIds.includes(project.id) ? 1 : 0)
    },
    busy(project: Project) { return context?.busy.has(project.id) ?? false },
    toggleLike(project: Project) {
      if (import.meta.env.PROD) void context?.toggleLike(project.id)
      else dispatch({ type: 'LIKE_TOGGLE', projectId: project.id })
    },
  }
}
