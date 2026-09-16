import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { HistoryResponse } from '../types'
import { ChartLegend, PriceChart } from './PriceChart'
import { ErrorNotice } from './ErrorNotice'

export const RANGE_OPTIONS = [
  { value: '6mo', label: '6개월' },
  { value: '1y', label: '1년' },
  { value: '5y', label: '5년' },
  { value: 'max', label: '전체' },
] as const
export type Range = (typeof RANGE_OPTIONS)[number]['value']

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

  useEffect(() => {
    setLoading(true)
    setError(null)
    api
      .getHistory(ticker, range)
      .then(setHistory)
      .catch(setError)
      .finally(() => setLoading(false))
  }, [ticker, range])

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
      </div>
    </div>
  )
}
