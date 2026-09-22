import { useEffect, useState } from 'react'
import {
  createChart,
  LineSeries,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from 'lightweight-charts'
import type { MacroHistory } from '../types'

/**
 * 매크로 지표 차트.
 *
 * **시세 차트(`PriceChart`)를 그대로 쓸 수 없다.** 그쪽은 세로축이 로그 스케일인데,
 * 로그는 0 이하를 그리지 못한다. 여기 오는 값 중에는 음수가 되는 것이 있다 —
 * 장단기 금리차가 마이너스가 되는 것(장단기 역전)이 이 화면에서 가장 볼 만한 장면이고,
 * 물가 전년비도 2015년과 2020년에 실제로 음수였다. 로그로 두면 하필 그 구간이 사라진다.
 *
 * 그래서 선형 스케일로 가고, 대신 **0선을 그린다.** 금리 4%가 3.9%가 되는 것과 물가가
 * +0.1%에서 −0.1%가 되는 것은 눈금상 같은 한 칸이지만 뜻이 전혀 다르다.
 */
function palette(light: boolean) {
  return light
    ? { text: '#52627a', grid: '#e5eaf2', line: '#0369a1', bg: '#ffffff', zero: '#94a3b8' }
    : { text: '#9fb0c3', grid: '#1c2736', line: '#38bdf8', bg: '#131b26', zero: '#64748b' }
}

/** 지금 테마를 구독한다 (PriceChart와 같은 이유 — 렌더 중 한 번만 읽으면 옛 색이 남는다) */
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

/**
 * 0선을 그릴 것인가 — **음수가 한 번이라도 나오면** 그린다.
 *
 * 항상 그리면 금리 4% 짜리 차트에 0선을 넣으려고 세로축이 0까지 늘어나, 정작 보고 싶은
 * 4.0~4.2의 움직임이 납작해진다. 반대로 음수가 나오는 차트에서는 0이 그 차트의 전부다 —
 * 금리차가 −0.2인지 +0.2인지가 장단기 역전 여부이고, 물가 전년비의 부호는 디플레이션
 * 여부다. 구간 전체가 음수여도 그린다: "얼마나 아래인가"를 보려면 기준선이 있어야 한다.
 */
export function needsZeroLine(points: { value: number }[]): boolean {
  return points.some((p) => p.value < 0)
}

interface Props {
  history: MacroHistory | null
  height?: number
}

export function MacroChart({ history, height = 340 }: Props) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const [handles, setHandles] = useState<{
    chart: IChartApi
    series: ISeriesApi<'Line'>
    zero: ISeriesApi<'Line'>
  } | null>(null)
  const light = useThemeIsLight()

  // 콜백 ref + state로 받는다. 모달로 띄우면 컨테이너가 나중에 나타나는데, useRef는
  // 채워져도 다시 렌더되지 않아 차트를 만드는 effect가 영영 안 돈다 (PriceChart와 같다).
  useEffect(() => {
    if (!container) return
    const colors = palette(light)
    const chart = createChart(container, {
      height,
      layout: { textColor: colors.text, background: { color: colors.bg }, attributionLogo: false },
      grid: { vertLines: { color: colors.grid }, horzLines: { color: colors.grid } },
      rightPriceScale: { borderColor: colors.grid },
      timeScale: { borderColor: colors.grid },
      crosshair: {
        vertLine: { labelBackgroundColor: colors.line },
        horzLine: { labelBackgroundColor: colors.line },
      },
    })
    const series = chart.addSeries(LineSeries, { color: colors.line, lineWidth: 2 })
    const zero = chart.addSeries(LineSeries, {
      color: colors.zero,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    })
    setHandles({ chart, series, zero })

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
    if (!handles) return
    const points = history?.points ?? []
    handles.series.setData(points.map((p) => ({ time: p.as_of as Time, value: p.value })))
    handles.zero.setData(
      needsZeroLine(points) ? points.map((p) => ({ time: p.as_of as Time, value: 0 })) : [],
    )
    handles.chart.timeScale().fitContent()
  }, [handles, history])

  return (
    <div className="chart-shell">
      <div ref={setContainer} style={{ width: '100%' }} />
    </div>
  )
}
