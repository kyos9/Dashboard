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

export const MARKER_COLOR: Record<string, string> = {
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
 * 로그 스케일 종가 차트 + 매수/어깨매도 마커.
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

    handles.markers.setMarkers(markers)
    handles.chart.timeScale().fitContent()
  }, [handles, history])

  return (
    <div className="chart-shell">
      <div ref={setContainer} style={{ width: '100%' }} />
    </div>
  )
}

/** 범례에 쓸 마커 집계 */
export function useMarkerCounts(history: HistoryResponse | null) {
  return useMemo(() => {
    const shoulderDays = history?.markers.filter((m) => m.kind === 'shoulder_ref') ?? []
    return {
      buy_signal: history?.markers.filter((m) => m.kind === 'buy_signal').length ?? 0,
      buy_fallback: history?.markers.filter((m) => m.kind === 'buy_fallback').length ?? 0,
      shoulderDays: shoulderDays.length,
      shoulderStreaks: collapseStreaks(shoulderDays).length,
    }
  }, [history])
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
        <i className="legend-dot" style={{ background: MARKER_COLOR.buy_signal }} aria-hidden="true" />
        무릎매수(시그널) {counts.buy_signal}건
      </span>
      <span>
        <i className="legend-dot" style={{ background: MARKER_COLOR.buy_fallback }} aria-hidden="true" />
        무릎매수(폴백) {counts.buy_fallback}건
      </span>
      <span>
        <i className="legend-dot" style={{ background: MARKER_COLOR.shoulder_ref }} aria-hidden="true" />
        어깨매도(참고) {counts.shoulderStreaks}구간 · {counts.shoulderDays}일
      </span>
      <span className="hint">
        {loading
          ? '불러오는 중…'
          : history
            ? `${history.prices.length}거래일 · 세로축 로그 스케일`
            : ''}
      </span>
    </div>
  )
}
