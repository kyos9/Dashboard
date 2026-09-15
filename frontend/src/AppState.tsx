import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { api } from './api/client'

interface AppState {
  /** 값이 바뀌면 각 화면이 데이터를 다시 불러온다 */
  refreshKey: number
  /** 화면에서 데이터를 변경했을 때 호출 (다른 화면도 최신값을 보게 됨) */
  notifyDataChanged: () => void
  /** 야후 시세를 전 종목 다시 받아온 뒤 화면 갱신 */
  refreshAll: () => Promise<void>
  refreshing: boolean
  lastSync: Date | null
  refreshError: string | null
}

const Ctx = createContext<AppState | null>(null)

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [refreshKey, setRefreshKey] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [lastSync, setLastSync] = useState<Date | null>(null)
  const [refreshError, setRefreshError] = useState<string | null>(null)

  const notifyDataChanged = useCallback(() => setRefreshKey((k) => k + 1), [])

  const refreshAll = useCallback(async () => {
    setRefreshing(true)
    setRefreshError(null)
    try {
      const results = await api.refreshAll()
      const failed = results.filter((r) => !r.ok)
      if (failed.length > 0) {
        setRefreshError(
          `${failed.length}개 종목 갱신 실패 — ${failed.map((f) => `${f.ticker}: ${f.error}`).join(' / ')}`,
        )
      }
      setLastSync(new Date())
    } catch (e) {
      setRefreshError(String(e))
    } finally {
      setRefreshing(false)
      setRefreshKey((k) => k + 1)
    }
  }, [])

  const value = useMemo(
    () => ({ refreshKey, notifyDataChanged, refreshAll, refreshing, lastSync, refreshError }),
    [refreshKey, notifyDataChanged, refreshAll, refreshing, lastSync, refreshError],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAppState(): AppState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAppState must be used inside AppStateProvider')
  return ctx
}
