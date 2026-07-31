import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type Dispatch,
  type PropsWithChildren,
} from 'react'
import { createInitialAppState } from './initialState'
import { appReducer } from './reducer'
import { hydrateAppState, persistAppState } from './storage'
import type { AppAction, AppState } from './types'

interface AppStateContextValue {
  state: AppState
  dispatch: Dispatch<AppAction>
}

const AppStateContext = createContext<AppStateContextValue | null>(null)

function initializeState() {
  const fallback = createInitialAppState()
  return typeof localStorage === 'undefined'
    ? fallback
    : hydrateAppState(fallback, localStorage)
}

export function AppStateProvider({ children }: PropsWithChildren) {
  const [state, dispatch] = useReducer(appReducer, undefined, initializeState)

  useEffect(() => {
    persistAppState(state)
  }, [state])

  const value = useMemo(() => ({ state, dispatch }), [state])

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>
}

export function useAppState() {
  const context = useContext(AppStateContext)
  if (!context) {
    throw new Error('useAppState must be used inside AppStateProvider')
  }
  return context
}
