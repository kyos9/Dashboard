import { useEffect, useMemo, useState } from 'react'
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
import { chartDate, chartPrice, chartTick, collapseStreaks, currencyOfTicker, markerDays } from '../lib/chartFormat'
import type { HistoryResponse } from '../types'
import { useSignalRules } from '../lib/signalRules'
import { SignalShape } from './SignalShape'

/* 차트에는 매수/매도 두 가지 점만 찍는다. 색은 대시보드 신호등과 같은 뜻으로 맞춘다
   (초록 = 매수 시그널, 빨강 = 매도 시그널). */
export const MARKER_COLOR: Record<string, string> = {
  buy: '#22c55e',
  sell: '#f05252',
}

/** 차트는 CSS 변수를 읽지 못하므로 현재 테마를 직접 확인해 색을 넘긴다 */
function chartPalette(light: boolean) {
  return light
    ? { text: '#52627a', grid: '#e5eaf2', line: '#0369a1', bg: '#ffffff' }
    : { text: '#9fb0c3', grid: '#1c2736', line: '#38bdf8', bg: '#131b26' }
}

/**
 * 지금 테마를 구독한다.
 *
 * 렌더 중에 한 번 읽기만 하면, 테마를 바꿔도 이 컴포넌트가 다른 이유로 다시 그려질
 * 때까지 옛 색이 남는다. data-theme 속성을 직접 지켜본다.
 */
function useThemeIsLight(): boolean {
  const [light, setLight] = useState(
    () => document.documentElement.getAttribute('data-theme') === 'light',
  )
  useEffect(() => {
    const target = document.documentElement
    const observer = new MutationObserver(() =>
      setLight(target.getAttribute('data-theme') === 'light'),
    )
    observer.observe(target, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])
  return light
}

interface ChartHandles {
  chart: IChartApi
  series: ISeriesApi<'Line'>
  markers: ISeriesMarkersPluginApi<Time>
}

interface Props {
  history: HistoryResponse | null
  height?: number
}

/**
 * 로그 스케일 종가 차트 + 매수/매도 시그널 마커.
 *
 * 차트를 붙일 DOM을 `useRef`가 아니라 **콜백 ref + state**로 받는다. ref는 값이
 * 채워져도 다시 렌더되지 않아서, 컨테이너가 나중에 나타나는 화면(종목을 불러오는
 * 동안 안내 문구만 보여주다가 표를 그리는 경우, 모달로 띄우는 경우)에서는 차트를
 * 만드는 effect가 영영 다시 돌지 않는다. 실제로 그렇게 차트가 안 뜨는 버그가 있었다.
 */
export function PriceChart({ history, height = 440 }: Props) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const [handles, setHandles] = useState<ChartHandles | null>(null)
  const light = useThemeIsLight()

  useEffect(() => {
    if (!container) return
    const palette = chartPalette(light)
    const chart = createChart(container, {
      height,
      layout: { textColor: palette.text, background: { color: palette.bg }, attributionLogo: false },
      // 언어를 못 박는다 — 브라우저 언어 태그가 이상하면("en-US@posix") 라이브러리가 Intl 에서 넘어져 차트가 빈 칸이 됐다
      localization: { locale: 'ko-KR', timeFormatter: chartDate },
      grid: {
        vertLines: { color: palette.grid },
        horzLines: { color: palette.grid },
      },
      rightPriceScale: { mode: PriceScaleMode.Logarithmic, borderColor: palette.grid },
      // 오른쪽에 몇 칸 비워 둔다 — 오늘 찍은 ▲ 가 끝에서 반쯤 잘리고 현재가 이름표와 겹쳤다 (B 사용자 확인)
      timeScale: { borderColor: palette.grid, tickMarkFormatter: chartTick, rightOffset: 3 },
      crosshair: {
        vertLine: { labelBackgroundColor: palette.line },
        horzLine: { labelBackgroundColor: palette.line },
      },
    })
    const series = chart.addSeries(LineSeries, { color: palette.line, lineWidth: 2 })
    setHandles({ chart, series, markers: createSeriesMarkers(series, []) })

    // 모달 안에서는 창 크기가 안 바뀌어도 컨테이너 폭이 달라진다 (열릴 때 등)
    const observer = new ResizeObserver(() => chart.applyOptions({ width: container.clientWidth }))
    observer.observe(container)
    chart.applyOptions({ width: container.clientWidth })

    return () => {
      observer.disconnect()
      chart.remove()
      setHandles(null)
    }
  }, [container, light, height])

  useEffect(() => {
    if (!handles || !history) return

    const currency = currencyOfTicker(history.ticker)
    handles.chart.applyOptions({ localization: { priceFormatter: (v: number) => chartPrice(v, currency) } })
    handles.series.setData(
      history.prices.map((p) => ({ time: p.date as Time, value: p.close })),
    )
    const tradingDays = history.prices.map((p) => p.date)

    // 글자는 붙이지 않는다 — 몇 달치를 한 화면에 놓으면 라벨끼리 겹쳐서 선이 안 보인다.
    // 매수는 선 아래 ▲, 매도는 선 위 ▼ — 색·위치·모양 셋으로 구분된다 (화면의 시그널 모양과 같다, 8-4).
    const dots = (kind: 'buy' | 'sell'): SeriesMarker<Time>[] =>
      markerDays(history.markers.filter((m) => m.kind === kind), tradingDays).map((day) => ({
        time: day.date as Time,
        position: kind === 'buy' ? 'belowBar' : 'aboveBar',
        color: MARKER_COLOR[kind],
        shape: kind === 'buy' ? 'arrowUp' : 'arrowDown',
      }))

    const markers = [...dots('buy'), ...dots('sell')].sort((a, b) =>
      String(a.time) < String(b.time) ? -1 : String(a.time) > String(b.time) ? 1 : 0,
    )

    handles.markers.setMarkers(markers)
    handles.chart.timeScale().fitContent()
  }, [handles, history])

  return (
    <div className="chart-shell">
      <div ref={setContainer} style={{ width: '100%' }} />
    </div>
  )
}

/** 범례에 쓸 집계 — 점 하나가 "연속으로 뜬 한 구간"이라 일수와 구간 수를 나눠 센다 */
export function useMarkerCounts(history: HistoryResponse | null) {
  return useMemo(() => {
    const count = (kind: 'buy' | 'sell') => {
      const days = history?.markers.filter((m) => m.kind === kind) ?? []
      return { days: days.length, streaks: collapseStreaks(days, history?.prices.map((p) => p.date)).length }
    }
    return { buy: count('buy'), sell: count('sell') }
  }, [history])
}

/** 저장된 시세 구간을 사람이 읽는 말로 — "5년을 눌렀는데 1년만 보인다"의 답이 여기 있다 */
export function coverageText(history: HistoryResponse | null): string {
  const coverage = history?.coverage
  if (!coverage || !coverage.first_date || !coverage.last_date) return '저장된 시세 없음'
  return `저장된 시세 ${coverage.first_date} ~ ${coverage.last_date} · ${coverage.rows.toLocaleString('ko-KR')}거래일`
}

export function ChartLegend({
  history,
  loading,
}: {
  history: HistoryResponse | null
  loading: boolean
}) {
  const counts = useMarkerCounts(history)
  // 내 기준을 쓰는 사람의 점은 내 기준으로 찍혀 있다 (0.42.0) — 카드와 같은 기준임을 차트에서도 알게
  const mine = useSignalRules().custom === true
  return (
    <div className="legend-row">
      {mine && <span className="badge badge-grey">내 기준</span>}
      <span>
        <SignalShape kind="buy" />
        매수 {counts.buy.streaks}구간 · {counts.buy.days}일
      </span>
      <span>
        <SignalShape kind="sell" />
        매도 {counts.sell.streaks}구간 · {counts.sell.days}일
      </span>
      <span className="hint">
        {loading
          ? '불러오는 중…'
          : history
            ? `${history.prices.length}거래일 표시 · 세로축 로그 스케일`
            : ''}
      </span>
    </div>
  )
}
