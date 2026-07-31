import { createContext, useCallback, useContext, useMemo, useState, type PropsWithChildren } from 'react'
import { Link } from 'react-router-dom'
import { Button, ConfirmDialog, Modal, Tag, useToast } from '../../components'
import { projectById } from '../../mocks'
import { useAppState } from '../../state'
import type { ProjectId } from '../../types'

interface ComparisonContextValue {
  addProject: (projectId: ProjectId) => 'added' | 'duplicate' | 'replace_required'
  removeProject: (projectId: ProjectId) => void
}

const ComparisonContext = createContext<ComparisonContextValue | null>(null)

function projectName(id: ProjectId) {
  const fact = projectById.get(id)?.currentName
  return fact?.state === 'known' ? fact.value : '名称未知的作品'
}

export function ComparisonProvider({ children }: PropsWithChildren) {
  const { state, dispatch } = useAppState()
  const { pushToast } = useToast()
  const [replacementCandidate, setReplacementCandidate] = useState<ProjectId | null>(null)

  const addProject = useCallback((id: ProjectId) => {
    if (state.comparisonProjectIds.includes(id)) {
      pushToast('这个作品已经在比较栏中。')
      return 'duplicate' as const
    }
    if (state.comparisonProjectIds.length >= 5) {
      setReplacementCandidate(id)
      return 'replace_required' as const
    }
    dispatch({ type: 'COMPARISON_ADD', projectId: id })
    pushToast('已加入比较。', 'success')
    return 'added' as const
  }, [dispatch, pushToast, state.comparisonProjectIds])

  const removeProject = useCallback((projectId: ProjectId) => dispatch({ type: 'COMPARISON_REMOVE', projectId }), [dispatch])
  const value = useMemo(() => ({ addProject, removeProject }), [addProject, removeProject])

  return (
    <ComparisonContext.Provider value={value}>
      {children}
      <Modal open={replacementCandidate !== null} title="比较栏已满，请选择替换项" onClose={() => setReplacementCandidate(null)}>
        <p>每次可比较 2–5 个作品。选择一个当前作品，用“{replacementCandidate ? projectName(replacementCandidate) : ''}”替换。</p>
        <div className="replacement-list">
          {state.comparisonProjectIds.map((currentId) => (
            <Button key={currentId} onClick={() => {
              if (!replacementCandidate) return
              dispatch({ type: 'COMPARISON_REPLACE', removeId: currentId, addId: replacementCandidate })
              pushToast('已替换比较作品。', 'success')
              setReplacementCandidate(null)
            }}>用{replacementCandidate ? projectName(replacementCandidate) : '候选作品'}替换{projectName(currentId)}</Button>
          ))}
        </div>
      </Modal>
    </ComparisonContext.Provider>
  )
}

export function useComparison() {
  const context = useContext(ComparisonContext)
  if (!context) throw new Error('useComparison must be used inside ComparisonProvider')
  return context
}

export function FloatingCompareBar() {
  const { state, dispatch } = useAppState()
  const { removeProject } = useComparison()
  const [confirmClear, setConfirmClear] = useState(false)
  const ids = state.comparisonProjectIds
  if (ids.length === 0) return null

  return (
    <aside className="compare-bar" aria-label="当前比较栏">
      <div className="compare-bar__summary"><strong>比较栏 · {ids.length}/5</strong><span>{ids.length === 1 ? '再选 1 个即可开始' : `已选择 ${ids.length} 个作品`}</span></div>
      <div className="compare-bar__items">
        {ids.map((id) => <span key={id} className="compare-chip"><Tag>{projectName(id)}</Tag><button type="button" aria-label={`移出${projectName(id)}`} onClick={() => removeProject(id)}>×</button></span>)}
      </div>
      <div className="cluster">
        <Button variant="quiet" onClick={() => setConfirmClear(true)}>清空</Button>
        {ids.length >= 2 ? <Link className="button button--primary" to={`/compare/current?ids=${ids.join(',')}`}>开始比较</Link> : <Button variant="primary" disabled>开始比较</Button>}
      </div>
      <ConfirmDialog open={confirmClear} title="清空比较栏？" description="已选择的作品将从本次比较中移除。" confirmLabel="确认清空" onCancel={() => setConfirmClear(false)} onConfirm={() => { dispatch({ type: 'COMPARISON_CLEAR' }); setConfirmClear(false) }} />
    </aside>
  )
}
