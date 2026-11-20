import { useState } from 'react'
import { api } from '../../api/client'
import type { HistoryResponse } from '../../types'
import { useAuth } from '../AuthGate'
import { coverageText } from '../PriceChart'
import { needsBackfill, type Range } from '../../lib/chartRange'

/**
 * 저장된 구간을 알려주고, 모자라면 전체 기간을 다시 받게 한다.
 *
 * 문제를 느끼는 자리가 차트이므로 고치는 버튼도 여기 둔다. **다시 받기는 관리자만** —
 * 10년치를 통째로 받는 일이라 서버도 사용자에게는 막는다 (4-4b). 사용자에게는 짧다는
 * 사실만 알린다.
 */
export function ChartCoverage({
  ticker,
  history,
  range,
  onReloaded,
  onError,
}: {
  ticker: string
  history: HistoryResponse | null
  range: Range
  onReloaded: () => void
  onError: (e: unknown) => void
}) {
  const { isAdmin } = useAuth()
  const [busy, setBusy] = useState(false)

  const backfill = async () => {
    setBusy(true)
    try {
      await api.refreshStock(ticker, true)
      onReloaded()
    } catch (e) {
      onError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <p className="hint chart-coverage">
      {coverageText(history)}
      {needsBackfill(history, range) && !isAdmin && ' · 고른 기간보다 짧습니다(앞부분은 관리자가 받을 수 있습니다).'}
      {needsBackfill(history, range) && isAdmin && (
        <>
          {' · 고른 기간보다 짧습니다. '}
          <button className="link-btn" onClick={() => void backfill()} disabled={busy}>
            {busy ? '받는 중…' : '전체 기간 다시 받기'}
          </button>
        </>
      )}
    </p>
  )
}
