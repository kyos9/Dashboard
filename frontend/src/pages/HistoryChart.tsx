import { useEffect, useRef, useState } from 'react'
import {
  createChart,
  createSeriesMarkers,
  LineSeries,
  PriceScaleMode,
  type IChartApi,
  type ISeriesApi,
  type SeriesMarker,
  type Time,
} from 'lightweight-charts'
import { api } from '../api/client'
import type { HistoryResponse, Stock } from '../types'

const RANGE_OPTIONS = ['6mo', '1y', '5y', 'max'] as const
type Range = (typeof RANGE_OPTIONS)[number]

const MARKER_COLOR: Record<string, string> = {
  buy_signal: '#16a34a',
  buy_fallback: '#2563eb',
  shoulder_ref: '#f97316',
}
const MARKER_LABEL: Record<string, string> = {
  buy_signal: '무릎매수(시그널)',
  buy_fallback: '무릎매수(폴백)',
  shoulder_ref: '어깨매도(참고)',
}

export function HistoryChart() {
  const [stocks, setStocks] = useState<Stock[]>([])
  const [ticker, setTicker] = useState<string>('')
  const [range, setRange] = useState<Range>('1y')
  const [history, setHistory] = useState<HistoryResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Line'> | null>(null)

  useEffect(() => {
    api.listStocks().then((list) => {
      setStocks(list)
      setTicker((prev) => prev || list[0]?.ticker || '')
    })
  }, [])

  useEffect(() => {
    if (!ticker) return
    setError(null)
    api
      .getHistory(ticker, range)
      .then(setHistory)
      .catch((e) => setError(String(e)))
  }, [ticker, range])

  useEffect(() => {
    if (!containerRef.current) return
    const chart = createChart(containerRef.current, {
      height: 420,
      layout: { textColor: '#333' },
      rightPriceScale: { mode: PriceScaleMode.Logarithmic },
    })
    const series = chart.addSeries(LineSeries, { color: '#2563eb', lineWidth: 2 })
    chartRef.current = chart
    seriesRef.current = series

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
    }
  }, [])

  useEffect(() => {
    if (!history || !seriesRef.current) return

    seriesRef.current.setData(history.prices.map((p) => ({ time: p.date as Time, value: p.close })))

    const markers: SeriesMarker<Time>[] = history.markers
      .slice()
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
      .map((m) => ({
        time: m.date as Time,
        position: m.kind === 'shoulder_ref' ? 'aboveBar' : 'belowBar',
        color: MARKER_COLOR[m.kind],
        shape: m.kind === 'shoulder_ref' ? 'circle' : 'arrowUp',
        text: m.status === 'recommended' ? `${MARKER_LABEL[m.kind]}(추천)` : MARKER_LABEL[m.kind],
      }))

    createSeriesMarkers(seriesRef.current, markers)
    chartRef.current?.timeScale().fitContent()
  }, [history])

  return (
    <div>
      <h2>히스토리 차트</h2>
      <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
        <select value={ticker} onChange={(e) => setTicker(e.target.value)}>
          {stocks.map((s) => (
            <option key={s.ticker} value={s.ticker}>
              {s.ticker}
            </option>
          ))}
        </select>
        <select value={range} onChange={(e) => setRange(e.target.value as Range)}>
          {RANGE_OPTIONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      <div ref={containerRef} style={{ width: '100%' }} />
      <p style={{ fontSize: 12, color: '#666' }}>
        <span style={{ color: MARKER_COLOR.buy_signal }}>●</span> 무릎매수(시그널) &nbsp;
        <span style={{ color: MARKER_COLOR.buy_fallback }}>●</span> 무릎매수(폴백) &nbsp;
        <span style={{ color: MARKER_COLOR.shoulder_ref }}>●</span> 어깨매도(참고) — 로그 스케일
      </p>
    </div>
  )
}
