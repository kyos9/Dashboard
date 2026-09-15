import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  createChart,
  createSeriesMarkers,
  LineSeries,
  PriceScaleMode,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
} from 'lightweight-charts'
import { useAppState } from '../AppState'
import { api } from '../api/client'
import { ErrorNotice } from '../components/ErrorNotice'
import type { HistoryResponse, Stock } from '../types'

const RANGE_OPTIONS = [
  { value: '6mo', label: '6개월' },
  { value: '1y', label: '1년' },
  { value: '5y', label: '5년' },
  { value: 'max', label: '전체' },
] as const
type Range = (typeof RANGE_OPTIONS)[number]['value']

const MARKER_COLOR: Record<string, string> = {
  buy_signal: '#22c55e',
  buy_fallback: '#3b82f6',
  shoulder_ref: '#f0b429',
}
const MARKER_LABEL: Record<string, string> = {
  buy_signal: '무릎매수(시그널)',
  buy_fallback: '무릎매수(폴백)',
  shoulder_ref: '어깨매도(참고)',
}

/** 같은 흐름으로 볼 최대 간격(일). 주말/공휴일을 건너뛰어도 연속으로 인정하도록 넉넉히 잡는다. */
const STREAK_GAP_DAYS = 4

/**
 * 어깨매도(참고)는 며칠씩 연달아 뜨기 때문에 그대로 찍으면 라벨이 서로 겹쳐 읽을 수 없다.
 * 연속 발동 구간을 하나로 묶어 시작일에만 표시하고, 며칠짜리였는지를 라벨에 적는다.
 */
function collapseStreaks<T extends { date: string }>(items: T[]): { head: T; length: number }[] {
  const sorted = [...items].sort((a, b) => a.date.localeCompare(b.date))
  const groups: { head: T; length: number; tail: string }[] = []
  const asDays = (d: string) => new Date(`${d}T00:00:00Z`).getTime() / 86_400_000

  for (const item of sorted) {
    const last = groups[groups.length - 1]
    if (last && asDays(item.date) - asDays(last.tail) <= STREAK_GAP_DAYS) {
      last.length += 1
      last.tail = item.date
      continue
    }
    groups.push({ head: item, length: 1, tail: item.date })
  }
  return groups.map(({ head, length }) => ({ head, length }))
}

/** 차트는 CSS 변수를 읽지 못하므로 현재 테마를 직접 확인해 색을 넘긴다 */
function chartPalette() {
  const light = document.documentElement.getAttribute('data-theme') === 'light'
  return light
    ? { text: '#52627a', grid: '#e5eaf2', line: '#0369a1', bg: '#ffffff' }
    : { text: '#9fb0c3', grid: '#1c2736', line: '#38bdf8', bg: '#131b26' }
}

export function HistoryChart() {
  const { refreshKey } = useAppState()
  const [searchParams, setSearchParams] = useSearchParams()
  const [stocks, setStocks] = useState<Stock[]>([])
  const [range, setRange] = useState<Range>('1y')
  const [history, setHistory] = useState<HistoryResponse | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(false)

  const ticker = searchParams.get('ticker') ?? ''

  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Line'> | null>(null)
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null)

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

  // 차트 인스턴스는 테마가 바뀔 때만 다시 만든다
  const theme = document.documentElement.getAttribute('data-theme')
  useEffect(() => {
    if (!containerRef.current) return
    const palette = chartPalette()
    const chart = createChart(containerRef.current, {
      height: 440,
      layout: { textColor: palette.text, background: { color: palette.bg }, attributionLogo: false },
      grid: {
        vertLines: { color: palette.grid },
        horzLines: { color: palette.grid },
      },
      rightPriceScale: { mode: PriceScaleMode.Logarithmic, borderColor: palette.grid },
      timeScale: { borderColor: palette.grid },
      crosshair: { vertLine: { labelBackgroundColor: palette.line }, horzLine: { labelBackgroundColor: palette.line } },
    })
    const series = chart.addSeries(LineSeries, { color: palette.line, lineWidth: 2 })
    chartRef.current = chart
    seriesRef.current = series
    markersRef.current = createSeriesMarkers(series, [])

    const handleResize = () => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth })
    }
    window.addEventListener('resize', handleResize)
    handleResize()

    return () => {
      window.removeEventListener('resize', handleResize)
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
      markersRef.current = null
    }
  }, [theme])

  useEffect(() => {
    if (!history || !seriesRef.current) return

    seriesRef.current.setData(history.prices.map((p) => ({ time: p.date as Time, value: p.close })))

    // 매수는 기간당 한 번뿐이라 그대로 찍고, 어깨매도는 연속 구간을 묶어 겹침을 없앤다.
    const buyMarkers: SeriesMarker<Time>[] = history.markers
      .filter((m) => m.kind !== 'shoulder_ref')
      .map((m) => ({
        time: m.date as Time,
        position: 'belowBar',
        color: MARKER_COLOR[m.kind],
        shape: 'arrowUp',
        text: m.status === 'recommended' ? `${MARKER_LABEL[m.kind]} 추천` : MARKER_LABEL[m.kind],
      }))

    const shoulderMarkers: SeriesMarker<Time>[] = collapseStreaks(
      history.markers.filter((m) => m.kind === 'shoulder_ref'),
    ).map(({ head, length }) => ({
      time: head.date as Time,
      position: 'aboveBar',
      color: MARKER_COLOR.shoulder_ref,
      shape: 'circle',
      text: length > 1 ? `어깨매도 ${length}일` : '어깨매도',
    }))

    const markers = [...buyMarkers, ...shoulderMarkers].sort((a, b) =>
      String(a.time) < String(b.time) ? -1 : String(a.time) > String(b.time) ? 1 : 0,
    )

    markersRef.current?.setMarkers(markers)
    chartRef.current?.timeScale().fitContent()
  }, [history, theme])

  const markerCounts = useMemo(() => {
    const shoulderDays = history?.markers.filter((m) => m.kind === 'shoulder_ref') ?? []
    return {
      buy_signal: history?.markers.filter((m) => m.kind === 'buy_signal').length ?? 0,
      buy_fallback: history?.markers.filter((m) => m.kind === 'buy_fallback').length ?? 0,
      shoulderDays: shoulderDays.length,
      shoulderStreaks: collapseStreaks(shoulderDays).length,
    }
  }, [history])

  if (stocks.length === 0 && !error) {
    return (
      <div className="empty-state">
        <h3>차트로 볼 종목이 없습니다</h3>
        <p>종목 관리 화면에서 종목을 먼저 추가해주세요.</p>
      </div>
    )
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>히스토리 차트</h2>
          <p className="hint">
            로그 스케일 종가 차트에 매수 실행일과 어깨매도(참고) 발동일을 표시합니다.
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
              {s.ticker}
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

      <div className="chart-shell">
        <div ref={containerRef} style={{ width: '100%' }} />
      </div>

      <div className="legend-row">
        <span>
          <i className="legend-dot" style={{ background: MARKER_COLOR.buy_signal }} aria-hidden="true" />
          무릎매수(시그널) {markerCounts.buy_signal}건
        </span>
        <span>
          <i className="legend-dot" style={{ background: MARKER_COLOR.buy_fallback }} aria-hidden="true" />
          무릎매수(폴백) {markerCounts.buy_fallback}건
        </span>
        <span>
          <i className="legend-dot" style={{ background: MARKER_COLOR.shoulder_ref }} aria-hidden="true" />
          어깨매도(참고) {markerCounts.shoulderStreaks}구간 · {markerCounts.shoulderDays}일
        </span>
        <span className="hint">
          {loading
            ? '불러오는 중…'
            : history
              ? `${history.prices.length}거래일 · 세로축 로그 스케일`
              : ''}
        </span>
      </div>
    </div>
  )
}
