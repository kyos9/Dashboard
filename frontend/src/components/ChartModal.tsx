import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { useBackToClose } from '../lib/backToClose'
import type { HistoryResponse } from '../types'
import { useAuth } from './AuthGate'
import { ChartLegend, coverageText, PriceChart } from './PriceChart'
import { ErrorNotice } from './ErrorNotice'

export const RANGE_OPTIONS = [
  { value: '6mo', label: '6개월', days: 182 },
  { value: '1y', label: '1년', days: 365 },
  { value: '5y', label: '5년', days: 365 * 5 },
  { value: 'max', label: '전체', days: null },
] as const
export type Range = (typeof RANGE_OPTIONS)[number]['value']

/**
 * 고른 기간보다 저장된 시세가 짧은가.
 *
 * "5년을 눌렀는데 1년만 보인다"는 차트가 아니라 받아둔 데이터의 문제다. 평소 갱신은
 * 최근 2년만 받으므로, 등록할 때 전체를 못 받았으면 그 앞은 영영 비어 있게 된다.
 * 전체(max)는 얼마나 더 있는지 알 길이 없어 항상 다시 받아볼 수 있게 둔다.
 */
export function needsBackfill(history: HistoryResponse | null, range: Range): boolean {
  const first = history?.coverage?.first_date
  if (!first) return false
  const days = RANGE_OPTIONS.find((r) => r.value === range)?.days
  if (days == null) return true
  const cutoff = new Date(Date.now() - days * 86_400_000)
  // 주말·휴장일 때문에 며칠은 늘 비는다 — 한 주 넘게 모자랄 때만 말한다
  return new Date(`${first}T00:00:00Z`).getTime() - cutoff.getTime() > 7 * 86_400_000
}

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
      {needsBackfill(history, range) && !isAdmin && ' — 고른 기간보다 짧습니다 (앞부분은 관리자가 받을 수 있습니다).'}
      {needsBackfill(history, range) && isAdmin && (
        <>
          {' — 고른 기간보다 짧습니다. '}
          <button className="link-btn" onClick={() => void backfill()} disabled={busy}>
            {busy ? '받는 중…' : '전체 기간 다시 받기'}
          </button>
        </>
      )}
    </p>
  )
}

interface Props {
  ticker: string
  name?: string | null
  onClose: () => void
}

/**
 * 종목 차트를 화면 위에 띄운다.
 *
 * 차트를 보려고 페이지를 떠나면 보던 표의 스크롤 위치와 필터가 날아가고, 돌아오면
 * 다시 찾아야 한다. 차트는 "잠깐 확인하는" 것이므로 지금 화면 위에 얹는다.
 */
export function ChartModal({ ticker, name, onClose }: Props) {
  const [range, setRange] = useState<Range>('1y')
  const [history, setHistory] = useState<HistoryResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    setLoading(true)
    setError(null)
    api
      .getHistory(ticker, range)
      .then(setHistory)
      .catch(setError)
      .finally(() => setLoading(false))
  }, [ticker, range, reloadKey])

  // 폰의 뒤로가기로도 닫힌다
  useBackToClose(onClose)

  // ESC로 닫기 + 뒤 화면이 같이 스크롤되지 않게
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [onClose])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal chart-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`${name ?? ticker} 차트`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div className="modal-title">
            <h3>{name ?? ticker}</h3>
            <span className="hint">{ticker}</span>
          </div>
          <div className="chip-row">
            {RANGE_OPTIONS.map((r) => (
              <button
                key={r.value}
                className={`chip${range === r.value ? ' active' : ''}`}
                onClick={() => setRange(r.value)}
              >
                {r.label}
              </button>
            ))}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </div>

        <ErrorNotice error={error} onDismiss={() => setError(null)} />
        <PriceChart history={history} height={380} />
        <ChartLegend history={history} loading={loading} />
        <ChartCoverage
          ticker={ticker}
          history={history}
          range={range}
          onReloaded={() => setReloadKey((k) => k + 1)}
          onError={setError}
        />
      </div>
    </div>
  )
}
