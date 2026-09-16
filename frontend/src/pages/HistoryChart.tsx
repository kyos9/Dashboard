import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAppState } from '../AppState'
import { api } from '../api/client'
import { ErrorNotice } from '../components/ErrorNotice'
import { ChartLegend, PriceChart } from '../components/PriceChart'
import { RANGE_OPTIONS, type Range } from '../components/ChartModal'
import type { HistoryResponse, Stock } from '../types'

export function HistoryChart() {
  const { refreshKey } = useAppState()
  const [searchParams, setSearchParams] = useSearchParams()
  const [stocks, setStocks] = useState<Stock[]>([])
  const [range, setRange] = useState<Range>('1y')
  const [history, setHistory] = useState<HistoryResponse | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(false)

  const ticker = searchParams.get('ticker') ?? ''

  useEffect(() => {
    api
      .listStocks()
      .then((list) => {
        const active = list.filter((s) => s.active)
        setStocks(active)
        if (!searchParams.get('ticker') && active[0]) {
          setSearchParams({ ticker: active[0].ticker }, { replace: true })
        }
      })
      .catch(setError)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey])

  useEffect(() => {
    if (!ticker) return
    setError(null)
    setLoading(true)
    api
      .getHistory(ticker, range)
      .then(setHistory)
      .catch(setError)
      .finally(() => setLoading(false))
  }, [ticker, range, refreshKey])

  if (stocks.length === 0 && !error) {
    return (
      <div className="empty-state">
        <h3>차트로 볼 종목이 없습니다</h3>
        <p>종목 관리 화면에서 종목을 먼저 추가해주세요.</p>
      </div>
    )
  }

  const current = stocks.find((s) => s.ticker === ticker)

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>히스토리 차트</h2>
          <p className="hint">
            로그 스케일 종가 차트에 매수 실행일과 매도 시그널 발동일을 표시합니다.
          </p>
        </div>
      </div>

      <div className="toolbar">
        <span className="toolbar-label">종목</span>
        <div className="chip-row">
          {stocks.map((s) => (
            <button
              key={s.ticker}
              className={`chip${ticker === s.ticker ? ' active' : ''}`}
              onClick={() => setSearchParams({ ticker: s.ticker }, { replace: true })}
            >
              {s.name ?? s.ticker}
            </button>
          ))}
        </div>
        <div className="chip-row spacer">
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
      </div>

      <ErrorNotice error={error} onDismiss={() => setError(null)} />

      {current && (
        <p className="hint chart-caption">
          {current.name ?? current.ticker} · {current.ticker}
        </p>
      )}
      <PriceChart history={history} />
      <ChartLegend history={history} loading={loading} />
    </div>
  )
}
