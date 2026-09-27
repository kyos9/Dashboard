import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api } from './api/client'
import { clearCache, lastLoadedAt } from './lib/cache'

/**
 * 앱으로 돌아왔을 때 이보다 오래 전에 받은 화면이면 조용히 다시 받는다 (ROADMAP 8-1).
 * 폰에 설치한 앱은 며칠씩 떠 있다 — 어제 연 화면이 그대로 남아 오늘 값인 척하면 안 된다.
 */
export const STALE_AFTER_MS = 5 * 60 * 1000

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

  // 무엇을 고쳤으면 캐시를 비운다 — 다른 탭이 고치기 전 값을 한 순간이라도 보이지 않게
  const notifyDataChanged = useCallback(() => {
    clearCache()
    setRefreshKey((k) => k + 1)
  }, [])

  // 앱으로 돌아왔는데 받은 지 오래면 다시 받는다. 캐시는 비우지 않는다 — 보던 값은 그대로
  // 두고 뒤에서 바꾼다(고친 것이 없으니 옛 값이 틀린 게 아니라 오래됐을 뿐이다).
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      const last = lastLoadedAt()
      if (last !== null && Date.now() - last > STALE_AFTER_MS) setRefreshKey((k) => k + 1)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  const refreshAll = useCallback(async () => {
    setRefreshing(true)
    setRefreshError(null)
    try {
      const results = await api.refreshAll()
      const failed = results.filter((r) => !r.ok)
      if (failed.length > 0) {
        // 사유가 같으면 한 번만 보여준다 (네트워크가 막히면 전 종목이 같은 이유로 실패한다)
        const hints = [...new Set(failed.map((f) => f.hint).filter(Boolean))]
        setRefreshError(
          `${failed.length}개 종목 갱신 실패 (${failed.map((f) => f.ticker).join(', ')}) — ` +
            (hints.join(' ') || failed[0].error || '원인 불명'),
        )
      }
      setLastSync(new Date())
    } catch (e) {
      setRefreshError(e instanceof Error ? e.message : String(e))
    } finally {
      setRefreshing(false)
      clearCache()
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
