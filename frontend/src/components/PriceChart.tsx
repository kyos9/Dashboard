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
import type { HistoryResponse } from '../types'

/* 차트에는 매수/매도 두 가지 점만 찍는다. 색은 대시보드 신호등과 같은 뜻으로 맞춘다
   (초록 = 사라는 신호, 빨강 = 팔라는 신호). */
export const MARKER_COLOR: Record<string, string> = {
  buy: '#22c55e',
  sell: '#f05252',
}

/** 같은 흐름으로 볼 최대 간격(일). 주말/공휴일을 건너뛰어도 연속으로 인정하도록 넉넉히 잡는다. */
const STREAK_GAP_DAYS = 4

/**
 * 시그널은 며칠씩 연달아 뜨기 때문에 그대로 찍으면 점이 뭉쳐 하나의 덩어리가 된다.
 * 연속 발동 구간을 하나로 묶어 시작일에만 찍는다.
 */
export function collapseStreaks<T extends { date: string }>(items: T[]): { head: T; length: number }[] {
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
      grid: {
        vertLines: { color: palette.grid },
        horzLines: { color: palette.grid },
      },
      rightPriceScale: { mode: PriceScaleMode.Logarithmic, borderColor: palette.grid },
      timeScale: { borderColor: palette.grid },
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

    handles.series.setData(
      history.prices.map((p) => ({ time: p.date as Time, value: p.close })),
    )

    // 글자는 붙이지 않는다 — 몇 달치를 한 화면에 놓으면 라벨끼리 겹쳐서 선이 안 보인다.
    // 매수는 선 아래, 매도는 선 위에 찍어 색과 위치 두 가지로 구분된다.
    const dots = (kind: 'buy' | 'sell'): SeriesMarker<Time>[] =>
      collapseStreaks(history.markers.filter((m) => m.kind === kind)).map(({ head }) => ({
        time: head.date as Time,
        position: kind === 'buy' ? 'belowBar' : 'aboveBar',
        color: MARKER_COLOR[kind],
        shape: 'circle',
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
      return { days: days.length, streaks: collapseStreaks(days).length }
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
  return (
    <div className="legend-row">
      <span>
        <i className="legend-dot" style={{ background: MARKER_COLOR.buy }} aria-hidden="true" />
        매수 {counts.buy.streaks}구간 · {counts.buy.days}일
      </span>
      <span>
        <i className="legend-dot" style={{ background: MARKER_COLOR.sell }} aria-hidden="true" />
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
