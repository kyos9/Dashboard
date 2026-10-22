import { NoStocksYet } from '../components/NoStocksYet'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAppState } from '../AppState'
import { api } from '../api/client'
import { ErrorNotice } from '../components/ErrorNotice'
import { ChartLegend, PriceChart } from '../components/PriceChart'
import { ChartCoverage, RANGE_OPTIONS, type Range } from '../components/ChartModal'
import { stockLabel } from '../lib/display'
import type { HistoryResponse, Stock } from '../types'

export function HistoryChart() {
  const { refreshKey } = useAppState()
  const [searchParams, setSearchParams] = useSearchParams()
  // 담은 종목 전체(비활성 포함). null = 아직 못 받음 — 0개와 가르려고(0.45.1 B2)
  const [all, setAll] = useState<Stock[] | null>(null)
  const [range, setRange] = useState<Range>('1y')
  const [history, setHistory] = useState<HistoryResponse | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  const ticker = searchParams.get('ticker') ?? ''
  const stocks = (all ?? []).filter((s) => s.active)
  // 주소의 티커가 담은 종목 어디에도 없다 — 서버의 영어 404("stock not found")와 빈 범례("매수 0일") 대신 한 줄로 말한다(0.45 D 사용자 확인).
  // 비활성 종목·소문자 주소는 지금처럼 연다(서버가 대문자로 바꿔 돌려준다)
  const match = ticker ? all?.find((s) => s.ticker.toUpperCase() === ticker.toUpperCase() || s.name === ticker) : undefined
  const unknown = all !== null && ticker !== '' && !match
  // 시세는 담은 종목의 티커로 — 주소를 바꾸기 전에 한 번 소문자로 부르지 않게
  const shownTicker = match?.ticker ?? ticker

  useEffect(() => {
    api
      .listStocks()
      .then((list) => {
        const active = list.filter((s) => s.active)
        setAll(list)
        const asked = searchParams.get('ticker')
        if (!asked && active[0]) {
          setSearchParams({ ticker: active[0].ticker }, { replace: true })
          return
        }
        // 소문자 주소(`voo`)·이름 주소(`삼성전자`)는 담은 종목의 티커로 바꿔 둔다 — 그대로 두면 소문자는 차트는 뜨는데 이름 줄·눌린 칩이
        // 없어 어느 종목인지 몰랐고, 이름은 "담은 종목에 없습니다"라면서 바로 위 칩에 있었다(0.45.1 BCD 사용자 확인)
        const same = asked && list.find((s) => s.ticker.toUpperCase() === asked.toUpperCase() || s.name === asked)
        if (same && same.ticker !== asked) setSearchParams({ ticker: same.ticker }, { replace: true })
      })
      .catch(setError)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey])

  // 목록을 받은 뒤에 부른다 — 먼저 부르면 없는 티커 주소가 404 를 한 번 내고 콘솔 오류로 남았다(0.45.1 B2 브라우저 확인)
  const listed = all !== null
  useEffect(() => {
    if (!shownTicker || !listed || unknown) return
    setError(null)
    setLoading(true)
    api
      .getHistory(shownTicker, range)
      .then(setHistory)
      .catch(setError)
      .finally(() => setLoading(false))
  }, [shownTicker, range, refreshKey, reloadKey, listed, unknown])

  if (all !== null && stocks.length === 0 && !error) {
    return (
      <NoStocksYet title="차트로 볼 종목이 없습니다" shows="종목별 차트가" />
    )
  }

  const current = stocks.find((s) => s.ticker === shownTicker)

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>히스토리 차트</h2>
          <p className="hint">
            로그 스케일 종가 차트에 매수(▲)·매도(▼) 시그널이 뜬 날을 표시합니다.
          </p>
        </div>
      </div>

      <div className="toolbar">
        <span className="toolbar-label">종목</span>
        <div className="chip-row">
          {stocks.map((s) => (
            <button
              key={s.ticker}
              className={`chip${shownTicker === s.ticker ? ' active' : ''}`}
              onClick={() => setSearchParams({ ticker: s.ticker }, { replace: true })}
            >
              {stockLabel(s)}
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

      {unknown ? (
        <p className="hint chart-caption" role="note">
          ‘{ticker}’ 은 담은 종목에 없습니다 — 위에서 종목을 고르세요.
        </p>
      ) : (
        <>
      <ErrorNotice error={error} onDismiss={() => setError(null)} />

      {current && (
        <p className="hint chart-caption">
          {stockLabel(current)} · {current.ticker}
        </p>
      )}
      <PriceChart history={history} />
      <ChartLegend history={history} loading={loading} />
      {ticker && (
        <ChartCoverage
          ticker={shownTicker}
          history={history}
          range={range}
          onReloaded={() => setReloadKey((k) => k + 1)}
          onError={setError}
        />
      )}
        </>
      )}
    </div>
  )
}
