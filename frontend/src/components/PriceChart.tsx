import { useEffect, useMemo, useRef, useState } from 'react'
import {
  createChart,
  createSeriesMarkers,
  LineSeries,
  PriceScaleMode,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type MouseEventParams,
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

/** 차트 위 한 줄에 보일 날 — `of` 는 그 날을 고른·가리킨 데이터 */
type Day = { date: string; close: number; of?: HistoryResponse | null }

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
    // 앞 데이터에서 놓은 십자선이 남아 새 데이터의 엉뚱한 날을 가리켰다(사용자 확인)
    handles.chart.clearCrosshairPosition?.()
  }, [handles, history])

  /* 고른 날과 가리키는 날 (0.44.0 C1 → 0.45.2 C2). 폰에서 짧게 탭하면 십자선이 그 자리로 오지 않고 앞서 있던 곳에 남아 탭한 자리로 직접 옮긴다.
     마우스가 차트를 떠나면 라이브러리가 십자선을 지운다 — 가리키는 날만 잊고 **고른 날**(탭·◀ ▶)로 돌아간다. 하나로 두면 PC 에서 차트를 누른 뒤
     ◀ 로 가는 사이 고른 날이 사라져 ◀ 가 늘 마지막 날에서 움직였다(계획 검토). */
  // `of` — 어느 데이터에서 고른·가리킨 날인가. 종목·기간을 바꾸면 버린다(날짜·값이 우연히 같아도 — 사용자 확인: 바꾼 뒤 엉뚱한 날이 남았다)
  const [hover, setHover] = useState<Day | null>(null)
  const [picked, setPicked] = useState<Day | null>(null)
  // 가리킴을 받을 때 — 아래 "진짜로 차트를 가리키고 있나" (BC 사용자 확인 · 끝 검토 다시)
  const pointing = useRef({ over: false, touch: false })
  const hoverRef = useRef<Day | null>(null)
  const pickedRef = useRef<Day | null>(null)
  // 사람이 밀거나 키워 보이는 구간을 바꿨나 — "전체 보기" (C3). 구간 이벤트는 데이터·창 크기에도 와서 쓰지 않는다(계획 검토)
  // 어느 데이터에서 밀었나 — 데이터가 바뀌면(종목·기간, 처음처럼 전체로 맞춘다) 저절로 내려간다
  const [movedOn, setMovedOn] = useState<HistoryResponse | null>(null)
  const moved = movedOn !== null && movedOn === history
  const prices = history?.prices

  useEffect(() => {
    if (!handles) return
    const { chart, series } = handles
    const onMove = (param: MouseEventParams<Time>) => {
      const point = param.time !== undefined ? param.seriesData.get(series) : undefined
      const value = (point as { value?: unknown } | undefined)?.value
      if (!pointing.current.over && !pointing.current.touch) return
      const day = typeof value === 'number' ? { date: chartDate(param.time as Time), close: value, of: history } : null
      hoverRef.current = day
      setHover(day)
    }
    chart.subscribeCrosshairMove(onMove)
    return () => chart.unsubscribeCrosshairMove(onMove)
  }, [handles, history])

  /* 보이는 구간이 바뀌면(밀기·키우기·전체 보기) 라이브러리는 십자선을 화면의 같은 자리에 둔다 — 그 자리는 이제 다른 날이라, 읽기 줄은 고른 날인데
     십자선·날짜 이름표는 딴 날이었다(C 사용자 다시 보기). 가리키는 중(마우스가 차트 위)이 아니면 고른 날로 다시 놓는다 */
  useEffect(() => {
    if (!handles) return
    const { chart, series } = handles
    const scale = chart.timeScale()
    let frame = 0
    const onRange = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const day = pickedRef.current
        if (!day || day.of !== history || hoverRef.current) return
        chart.setCrosshairPosition(day.close, day.date as Time, series)
      })
    }
    scale.subscribeVisibleLogicalRangeChange?.(onRange)
    return () => {
      cancelAnimationFrame(frame)
      scale.unsubscribeVisibleLogicalRangeChange?.(onRange)
    }
  }, [handles, history])

  /* 진짜로 차트를 가리키고 있나 — 마우스·펜이 차트 칸 위에 있거나 손가락이 차트를 누르고 있을 때만. 라이브러리는 그 밖에도 "가리킨 날"을 알린다:
     손가락 탭 뒤 흉내 마우스(화면이 밀리면 차트 위), 코드로 놓은 십자선이 구간이 바뀌어 화면의 같은 자리의 새 날로(끝 검토 다시: 전체 보기 뒤 ◀ 가 뒤로),
     단추를 누르는 손가락이 닿은 동안의 관성 이동. 마지막 포인터 종류로 가리면 이 둘을 놓쳤다 */
  useEffect(() => {
    if (!container) return
    const enter = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') pointing.current.over = true
    }
    const leave = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return
      pointing.current.over = false
      // 떠날 때 라이브러리가 보내는 "가리킴 없음"은 위에서 막히니 여기서 지운다 — 고른 날로 돌아간다
      hoverRef.current = null
      setHover(null)
    }
    const down = (e: PointerEvent) => {
      if (e.pointerType === 'touch') pointing.current.touch = true
    }
    const lift = (e: PointerEvent) => {
      if (e.pointerType === 'touch') pointing.current.touch = false
    }
    // 터치 노트북: 마우스를 차트 위에 둔 채 손가락으로 ◀ 를 누르면 남은 마우스의 가리킴이 ◀ 를 덮었다(끝 검토 세 번째) — 손가락이 닿으면 놓는다.
    // 마우스를 다시 움직이면 위 enter 가 되살린다
    const touchAnywhere = (e: PointerEvent) => {
      if (e.pointerType !== 'touch' || !pointing.current.over) return
      pointing.current.over = false
      hoverRef.current = null
      setHover(null)
    }
    container.addEventListener('pointerenter', enter)
    container.addEventListener('pointermove', enter)
    container.addEventListener('pointerleave', leave)
    container.addEventListener('pointerdown', down)
    window.addEventListener('pointerup', lift)
    window.addEventListener('pointercancel', lift)
    window.addEventListener('pointerdown', touchAnywhere, true)
    return () => {
      window.removeEventListener('pointerdown', touchAnywhere, true)
      container.removeEventListener('pointerenter', enter)
      container.removeEventListener('pointermove', enter)
      container.removeEventListener('pointerleave', leave)
      container.removeEventListener('pointerdown', down)
      window.removeEventListener('pointerup', lift)
      window.removeEventListener('pointercancel', lift)
    }
  }, [container])

  /** 고른 날을 바꾸고 십자선을 그 날로 */
  const pick = (index: number) => {
    const day = prices?.[index]
    if (!handles || !day) return
    handles.chart.setCrosshairPosition(day.close, day.date as Time, handles.series)
    pickedRef.current = { date: day.date, close: day.close, of: history }
    setPicked(pickedRef.current)
    // 누른 것이 가리키는 것보다 앞선다 — 남아 있던 가리킴(손가락 기기의 흉내 마우스 등)이 탭을 덮지 않게
    hoverRef.current = null
    setHover(null)
  }
  const pickRef = useRef(pick)
  useEffect(() => {
    pickRef.current = pick
  })

  /* 탭을 직접 받는다 (0.45.2 C1). 라이브러리의 click 은 0.5초 안에 30px 넘게 떨어진 두 번째 탭을 보내지 않았다(click·dblClick 어느 것도).
     누른 자리에서 10px 안·0.5초 안에 뗀 첫 손가락(마우스는 왼쪽 단추)만 탭 — 밀기·두 손가락(벌리기)·취소(세로 스크롤로 넘어감)는 탭이 아니다.
     길게 누른 뒤 떼면 라이브러리가 touchend 에서 십자선을 지우므로 그 뒤에 놓는다(setTimeout 0). 가격·날짜 축 위는 버린다. */
  useEffect(() => {
    if (!handles || !container) return
    const { chart } = handles
    let press: { id: number; x: number; y: number; at: number; tap: boolean } | null = null
    const down = (e: PointerEvent) => {
      if (press) {
        // 두 번째 손가락 — 벌려 키우기
        press.tap = false
        setMovedOn(history)
        return
      }
      if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return
      press = { id: e.pointerId, x: e.clientX, y: e.clientY, at: e.timeStamp, tap: true }
    }
    const move = (e: PointerEvent) => {
      if (!press || e.pointerId !== press.id) return
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) {
        // 손가락: 길게 누른 뒤 밀면(라이브러리의 날짜 따라가기, 240ms) 구간은 그대로다 — 그 전에 가로로 밀면 차트가 밀린다.
        // 마우스에는 길게 누르기가 없다 — 천천히 끌어도 밀린다(C 검토)
        const pans =
          e.pointerType === 'mouse' || (e.timeStamp - press.at < 240 && Math.abs(e.clientX - press.x) > Math.abs(e.clientY - press.y))
        if (press.tap && pans) setMovedOn(history)
        press.tap = false
      }
    }
    const up = (e: PointerEvent) => {
      if (!press || e.pointerId !== press.id) return
      const tap = press.tap && e.timeStamp - press.at < 500
      press = null
      if (!tap) {
        // 손가락으로 길게 누른 채 밀어 간 날은 뗀 뒤에도 그 날 — 처음 누른 날로 돌아가 ◀ 가 엉뚱한 데서 움직였다(BC 사용자 확인)
        const held = hoverRef.current
        const index = e.pointerType === 'touch' && held ? (prices ?? []).findIndex((p) => p.date === held.date) : -1
        if (index >= 0) window.setTimeout(() => pickRef.current(index), 0)
        return
      }
      const box = container.getBoundingClientRect()
      const x = e.clientX - box.left
      const y = e.clientY - box.top
      const scale = chart.timeScale()
      if (x < 0 || x > scale.width() || y < 0 || y > box.height - scale.height()) return
      const logical = scale.coordinateToLogical(x)
      if (logical === null) return
      // 오른쪽 빈 칸(오늘 ▲ 자리로 비워 둔 rightOffset)은 마지막 날 — 오늘로 돌아가는 길(0.44.0 C 사용자 확인)
      const last = (prices?.length ?? 0) - 1
      const index = Math.min(Math.max(Math.round(logical), 0), last)
      window.setTimeout(() => pickRef.current(index), 0)
    }
    const cancel = (e: PointerEvent) => {
      if (press && e.pointerId === press.id) press = null
    }
    // 마우스로 끌다 차트 밖에서 놓으면 차트 칸은 pointerup 을 못 받는다 — 누름이 남아 다음 클릭을 두 번째 손가락으로 봤다(C 검토).
    // 창에서 받아 버린다(차트 안에서 놓았으면 위 up 이 먼저 비웠다)
    const wheel = () => setMovedOn(history)
    container.addEventListener('pointerdown', down)
    container.addEventListener('pointermove', move)
    container.addEventListener('pointerup', up)
    container.addEventListener('pointercancel', cancel)
    container.addEventListener('wheel', wheel, { passive: true })
    window.addEventListener('pointerup', cancel)
    window.addEventListener('pointercancel', cancel)
    return () => {
      window.removeEventListener('pointerup', cancel)
      window.removeEventListener('pointercancel', cancel)
      container.removeEventListener('pointerdown', down)
      container.removeEventListener('pointermove', move)
      container.removeEventListener('pointerup', up)
      container.removeEventListener('pointercancel', cancel)
      container.removeEventListener('wheel', wheel)
    }
  }, [handles, container, prices, history])

  const last = prices?.[prices.length - 1]
  // 종목·기간을 바꾸면 고른·가리킨 날은 그 데이터에 없을 수 있다 — 그 날·그 값이 지금 데이터에 있을 때만 쓴다
  const valid = (day: Day | null) => (day && day.of === history ? day : null)
  const current = valid(hover) ?? valid(picked)
  const shown = current ?? (last ? { date: last.date, close: last.close } : null)
  // 보이는 날의 시그널 — 이어진 날 가운데 날도(차트의 점은 첫날만이라 원본을 본다)
  const daySignals = shown ? (history?.markers ?? []).filter((m) => m.date === shown.date).map((m) => m.kind) : []
  // ◀ ▶ 는 고른 날(없으면 마지막 날)에서 — 마우스가 가리키는 날이 아니다(단추를 누르러 가면 차트를 떠난다)
  const base = valid(picked) ?? (last ? { date: last.date, close: last.close } : null)
  const from = base && prices ? prices.findIndex((p) => p.date === base.date) : -1
  const step = (by: -1 | 1) => {
    if (from < 0 || !prices?.[from + by]) return
    pick(from + by)
  }
  const atStart = from <= 0
  const atEnd = !prices || from === prices.length - 1

  return (
    <div className="chart-shell">
      {shown && history && (
        <div className="chart-top">
          <p className="chart-readout" aria-live="polite">
            <span className="mono">{shown.date}</span> · 종가{' '}
            <span className="mono">{chartPrice(shown.close, currencyOfTicker(history.ticker))}</span>
            {/* 그 날이 시그널 날이면 풀이 대신 그 말 — 차트의 점은 이어진 날의 첫날만 찍혀 가운데 날은 점이 없고, 고른 점에 화살표가 가렸다(0.45.2 사용자 확인).
                점이 아닌 시그널 날 전부(원본 markers). 풀이보다 짧아 줄이 늘지 않는다 — 두 줄 자리는 CSS 가 잡는다 */}
            {daySignals.length > 0 ? (
              <span className="chart-day-signal">
                {daySignals.includes('buy') && (
                  <span className="nowrap">
                    {' · '}
                    <SignalShape kind="buy" /> 매수 시그널
                  </span>
                )}
                {daySignals.includes('sell') && (
                  <span className="nowrap">
                    {' · '}
                    <SignalShape kind="sell" /> 매도 시그널(참고)
                  </span>
                )}
              </span>
            ) : (
              /* 고른 뒤에도 같은 길이의 풀이를 둔다 — 풀이가 빠지면 폰에서 두 줄이 한 줄이 되어 단추·차트가 20px 뛰었다(검토·사용자 확인) */
              <span className="hint">
                {current && current.date !== last?.date ? ' (▶ 나 오른쪽 끝을 누르면 마지막 날)' : ' (마지막 날 · 차트를 누르면 그 날)'}
              </span>
            )}
          </p>
          {/* 1년 보기에서 1px 이 하루쯤이라 바로 옆 거래일을 손가락으로 짚기 어려웠다 (0.45.2 C2). 끝에서는 꺼 두되 포커스는 남긴다(aria-disabled) */}
          <div className="chart-tools">
            <button
              type="button"
              className="ghost chart-step"
              aria-label="이전 거래일"
              aria-disabled={atStart}
              onClick={() => !atStart && step(-1)}
            >
              ◀
            </button>
            <button
              type="button"
              className="ghost chart-step"
              aria-label="다음 거래일"
              aria-disabled={atEnd}
              onClick={() => !atEnd && step(1)}
            >
              ▶
            </button>
            {/* 밀거나 키운 뒤에만 — 자리는 늘 잡아 두어 뜨고 질 때 차트가 밀리지 않는다 (0.45.2 C3) */}
            <button
              type="button"
              className="ghost chart-fit"
              style={moved ? undefined : { visibility: 'hidden' }}
              aria-hidden={!moved}
              tabIndex={moved ? undefined : -1}
              onClick={(e) => {
                handles?.chart.timeScale().fitContent()
                setMovedOn(null)
                // 눌러서 숨는 단추에 남은 포커스가 화면 맨 위로 빠졌다 — 옆 ◀ 로 (C 검토)
                e.currentTarget.parentElement?.querySelector<HTMLButtonElement>('.chart-step')?.focus()
              }}
            >
              전체 보기
            </button>
          </div>
        </div>
      )}
      <div ref={setContainer} className="chart-canvas" style={{ width: '100%' }} />
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

const STREAK_HINT = '시그널이 뜬 날 수. 괄호는 며칠 이어서 뜬 것을 한 번으로 센 횟수(차트의 점 하나가 한 번)'

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
      {/* "매수 13구간 · 43일" — "구간"이 무엇인지 몰랐다 (디자인 2차). 날 수가 먼저, 이어진 묶음 수는 괄호에 */}
      <span title={STREAK_HINT}>
        <SignalShape kind="buy" />
        매수 <span className="nowrap">{counts.buy.days}일</span> <span className="nowrap">({counts.buy.streaks}번)</span>
      </span>
      <span title={STREAK_HINT}>
        <SignalShape kind="sell" />
        매도 <span className="nowrap">{counts.sell.days}일</span> <span className="nowrap">({counts.sell.streaks}번)</span>
      </span>
      <span className="hint">
        {loading
          ? '불러오는 중…'
          : history
            ? `${history.prices.length}거래일 표시 · 세로축 로그 스케일`
            : ''}
        {/* 손가락으로 밀면 차트가 통째로 밀린다 — 날짜를 따라가게 하는 길 (0.45.2 C3). 마우스는 올리기만 해도 따라와 손가락 기기에만 */}
        {!loading && history && <span className="touch-only"> · 길게 누른 채 밀면 날짜가 따라옵니다</span>}
      </span>
    </div>
  )
}
