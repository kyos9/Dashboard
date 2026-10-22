import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HistoryResponse } from '../types'
import { MARKER_COLOR, PriceChart } from './PriceChart'

/**
 * 차트에 찍히는 점만 본다.
 *
 * 예전에는 매수 실행 기록(시그널/정기)과 매도 시그널을 서로 다른 모양·색·라벨로
 * 찍었는데, 라벨이 서로 겹쳐 선을 가렸고 정기 매수는 "신호"가 아니라 그냥 달력이었다.
 * 지금은 매수/매도 두 가지 점만 남긴다.
 */

const setMarkers = vi.fn()
const series = { setData: vi.fn(), dataByIndex: vi.fn() }
const chart = {
  addSeries: vi.fn(() => series),
  applyOptions: vi.fn(),
  remove: vi.fn(),
  subscribeCrosshairMove: vi.fn(),
  unsubscribeCrosshairMove: vi.fn(),
  subscribeClick: vi.fn(),
  unsubscribeClick: vi.fn(),
  subscribeDblClick: vi.fn(),
  unsubscribeDblClick: vi.fn(),
  setCrosshairPosition: vi.fn(),
  timeScale: () => scale,
}
// 그림 칸 폭 300, 날짜 축 높이 30 — x 100px 마다 하루(0 → 첫날)
const scale = { fitContent: vi.fn(), width: () => 300, height: () => 30, coordinateToLogical: (x: number) => x / 100 }

const created: unknown[] = []
vi.mock('lightweight-charts', () => ({
  createChart: (_el: unknown, options: unknown) => {
    created.push(options)
    return chart
  },
  createSeriesMarkers: () => ({ setMarkers: (m: unknown) => setMarkers(m) }),
  LineSeries: 'Line',
  PriceScaleMode: { Logarithmic: 1 },
}))

function history(markers: HistoryResponse['markers']): HistoryResponse {
  return {
    ticker: 'VOO',
    prices: [
      { date: '2026-09-14', close: 100 },
      { date: '2026-09-15', close: 101 },
      { date: '2026-09-16', close: 102 },
    ],
    markers,
    coverage: { first_date: '2020-01-02', last_date: '2026-09-16', rows: 1_680 },
  }
}

const lastMarkers = () => setMarkers.mock.lastCall![0] as Record<string, unknown>[]

beforeEach(() => setMarkers.mockClear())

describe('차트 마커', () => {
  it('매수와 매도를 색과 위치로 구분한다', () => {
    render(
      <PriceChart
        history={history([
          { date: '2026-09-14', kind: 'buy' },
          { date: '2026-09-16', kind: 'sell' },
        ])}
      />,
    )

    const markers = lastMarkers()
    expect(markers).toHaveLength(2)

    const buy = markers.find((m) => m.time === '2026-09-14')!
    const sell = markers.find((m) => m.time === '2026-09-16')!
    expect(buy.color).toBe(MARKER_COLOR.buy)
    expect(sell.color).toBe(MARKER_COLOR.sell)
    expect(buy.color).not.toBe(sell.color)
    // 색만으로 구분되지 않게 위치도 나눈다
    expect(buy.position).toBe('belowBar')
    expect(sell.position).toBe('aboveBar')
  })

  it('모양만 찍고 글자는 붙이지 않는다 — 매수 ▲ · 매도 ▼', () => {
    // 몇 달치를 한 화면에 놓으면 라벨끼리 겹쳐 선이 보이지 않았다
    render(<PriceChart history={history([{ date: '2026-09-15', kind: 'buy' }, { date: '2026-09-16', kind: 'sell' }])} />)
    const [buy, sell] = lastMarkers()
    expect(buy.text).toBeUndefined()
    expect(buy.shape).toBe('arrowUp')
    expect(sell.shape).toBe('arrowDown')
  })

  it('연달아 뜬 날은 점 하나로 묶는다', () => {
    render(
      <PriceChart
        history={history([
          { date: '2026-09-14', kind: 'sell' },
          { date: '2026-09-15', kind: 'sell' },
        ])}
      />,
    )
    expect(lastMarkers()).toHaveLength(1)
    expect(lastMarkers()[0].time).toBe('2026-09-14')
  })

  it('오늘(차트 마지막 날)까지 이어진 구간은 오늘에도 찍는다 — 카드의 "오늘"과 차트가 맞게 (0.42.0)', () => {
    render(
      <PriceChart
        history={history([
          { date: '2026-09-14', kind: 'buy' },
          { date: '2026-09-15', kind: 'buy' },
          { date: '2026-09-16', kind: 'buy' },
        ])}
      />,
    )
    expect(lastMarkers().map((m) => m.time)).toEqual(['2026-09-14', '2026-09-16'])
  })

  it('같은 날 매수와 매도가 함께 뜨면 둘 다 찍는다', () => {
    // 한쪽이 조용히 가려지면 화면이 사실과 달라진다
    render(
      <PriceChart
        history={history([
          { date: '2026-09-16', kind: 'buy' },
          { date: '2026-09-16', kind: 'sell' },
        ])}
      />,
    )
    expect(lastMarkers()).toHaveLength(2)
  })

  it('시그널이 없으면 점도 없다', () => {
    render(<PriceChart history={history([])} />)
    expect(lastMarkers()).toEqual([])
  })

  it('언어를 ko-KR 로 못 박고, 세로축 가격은 그 종목 통화의 꼴로 (0.42.0 — "en-US@posix" 에서 빈 칸, "68000.00")', () => {
    created.length = 0
    chart.applyOptions.mockClear()
    render(<PriceChart history={{ ...history([]), ticker: '005930.KS' }} />)
    const options = created[0] as { localization: { locale: string; timeFormatter: (t: string) => string } }
    expect(options.localization.locale).toBe('ko-KR')
    expect(options.localization.timeFormatter('2026-10-09')).toBe('2026-10-09')
    const formatter = chart.applyOptions.mock.calls
      .map(([o]) => (o as { localization?: { priceFormatter?: (v: number) => string } }).localization?.priceFormatter)
      .find(Boolean)!
    expect(formatter(68000)).toBe('68,000')
  })
})

describe('차트 위 한 줄과 탭 (0.44.0 C1 · 0.45.2 C1~C3)', () => {
  type Handler = (param: { time?: string; seriesData: Map<unknown, unknown> }) => void
  const handler = (fn: unknown) => (fn as { mock: { lastCall: [Handler] } }).mock.lastCall[0]
  const at = (time: string | undefined, value?: number) => ({
    time,
    seriesData: new Map(value === undefined ? [] : [[series, { value }]]),
  })

  /** 차트 칸 — 화면 (0,0) 에 폭 300·높이 400 */
  function shown(h = history([])) {
    const view = render(<PriceChart history={h} />)
    const canvas = view.container.querySelector<HTMLElement>('.chart-canvas')!
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 400, right: 300, bottom: 400, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
    return { ...view, canvas, line: () => view.container.querySelector('.chart-readout')! }
  }

  /** 포인터 이벤트 — jsdom 에는 PointerEvent 가 없어 필요한 칸만 붙인다 */
  function pointer(target: Element, type: string, init: { x: number; y: number; t: number; id?: number; kind?: string; primary?: boolean; button?: number }) {
    const event = new Event(type, { bubbles: true })
    Object.defineProperties(event, {
      clientX: { value: init.x },
      clientY: { value: init.y },
      timeStamp: { value: init.t },
      pointerId: { value: init.id ?? 1 },
      pointerType: { value: init.kind ?? 'touch' },
      isPrimary: { value: init.primary ?? true },
      button: { value: init.button ?? 0 },
    })
    target.dispatchEvent(event)
  }

  async function tap(target: Element, x: number, y = 100, t = 0, extra: { kind?: string; button?: number } = {}) {
    const { act } = await import('@testing-library/react')
    pointer(target, 'pointerdown', { x, y, t, ...extra })
    pointer(target, 'pointerup', { x, y, t: t + 80, ...extra })
    // 라이브러리가 touchend 에서 십자선을 지운 뒤에 놓는다
    await act(() => new Promise((r) => setTimeout(r, 0)))
  }

  beforeEach(() => chart.setCrosshairPosition.mockClear())

  it('처음에는 마지막 날의 날짜·종가, 그 날이 "마지막 날"임을 말한다', () => {
    const { line } = shown()
    expect(line()).toHaveTextContent('2026-09-16 · 종가 102.00')
    expect(line()).toHaveTextContent('마지막 날 — 차트를 누르면 그 날')
  })

  it('짧게 탭하면 십자선을 그 자리로 옮기고, 한 줄이 그 날을 말한다', async () => {
    const { canvas, line } = shown()
    await tap(canvas, 0)
    expect(chart.setCrosshairPosition).toHaveBeenLastCalledWith(100, '2026-09-14', series)
    expect(line()).toHaveTextContent('2026-09-14 · 종가 100.00')
    expect(line()).not.toHaveTextContent('(마지막 날 —')
    // 풀이는 같은 길이로 남는다 — 빠지면 폰에서 줄 수가 바뀌어 단추·차트가 뛰었다
    expect(line()).toHaveTextContent('(▶ 나 오른쪽 끝을 누르면 마지막 날)')
  })

  it('라이브러리의 click·dblClick 은 받지 않는다 — 0.5초 안에 30px 넘게 떨어진 두 번째 탭을 보내지 않았다 (0.45.2 C1)', async () => {
    const { canvas, line } = shown()
    expect(chart.subscribeClick).not.toHaveBeenCalled()
    expect(chart.subscribeDblClick).not.toHaveBeenCalled()
    await tap(canvas, 0, 100, 0)
    await tap(canvas, 200, 100, 300)
    expect(line()).toHaveTextContent('2026-09-16 · 종가 102.00')
    await tap(canvas, 100, 100, 600)
    expect(line()).toHaveTextContent('2026-09-15 · 종가 101.00')
  })

  it('밀기·늦게 떼기·두 손가락·취소·오른쪽 단추·축 위는 탭이 아니다', async () => {
    const { act } = await import('@testing-library/react')
    const { canvas } = shown()
    const settle = () => act(() => new Promise((r) => setTimeout(r, 0)))
    // 밀기
    pointer(canvas, 'pointerdown', { x: 0, y: 100, t: 0 })
    pointer(canvas, 'pointermove', { x: 40, y: 100, t: 50 })
    pointer(canvas, 'pointerup', { x: 40, y: 100, t: 100 })
    // 늦게 떼기(길게 누르기)
    pointer(canvas, 'pointerdown', { x: 0, y: 100, t: 1000 })
    pointer(canvas, 'pointerup', { x: 0, y: 100, t: 1600 })
    // 두 손가락
    pointer(canvas, 'pointerdown', { x: 0, y: 100, t: 2000 })
    pointer(canvas, 'pointerdown', { x: 50, y: 100, t: 2010, id: 2, primary: false })
    pointer(canvas, 'pointerup', { x: 50, y: 100, t: 2050, id: 2, primary: false })
    pointer(canvas, 'pointerup', { x: 0, y: 100, t: 2060 })
    // 취소(세로 스크롤로 넘어감)
    pointer(canvas, 'pointerdown', { x: 0, y: 100, t: 3000 })
    pointer(canvas, 'pointercancel', { x: 0, y: 100, t: 3010 })
    pointer(canvas, 'pointerup', { x: 0, y: 100, t: 3020 })
    await settle()
    // 마우스 오른쪽 단추 · 가격 축(폭 300 밖) · 날짜 축(높이 400-30 아래)
    await tap(canvas, 0, 100, 4000, { kind: 'mouse', button: 2 })
    await tap(canvas, 310, 100, 5000)
    await tap(canvas, 0, 390, 6000)
    expect(chart.setCrosshairPosition).not.toHaveBeenCalled()
  })

  it('탭은 남아 있던 가리킴보다 앞선다 — 손가락 기기에 흉내 마우스가 차트 위에 남아 탭이 안 먹는 것처럼 보였다', async () => {
    const { act } = await import('@testing-library/react')
    const { canvas, line } = shown()
    act(() => handler(chart.subscribeCrosshairMove)(at('2026-09-15', 101)))
    await tap(canvas, 0)
    expect(line()).toHaveTextContent('2026-09-14 · 종가 100.00')
  })

  it('길게 누른 뒤 떼면 라이브러리가 touchend 에서 십자선을 지운다 — 그 뒤에 놓는다', async () => {
    const { act } = await import('@testing-library/react')
    const { canvas, line } = shown()
    pointer(canvas, 'pointerdown', { x: 0, y: 100, t: 0 })
    pointer(canvas, 'pointerup', { x: 0, y: 100, t: 80 })
    // 같은 박자(touchend)에는 아직 놓지 않는다
    expect(chart.setCrosshairPosition).not.toHaveBeenCalled()
    await act(() => new Promise((r) => setTimeout(r, 0)))
    expect(chart.setCrosshairPosition).toHaveBeenLastCalledWith(100, '2026-09-14', series)
    expect(line()).toHaveTextContent('2026-09-14 · 종가 100.00')
  })

  it('손가락으로 탭한 뒤 오는 흉내 마우스의 가리킴은 받지 않는다 — ◀ 를 눌러도 엉뚱한 날이 남았다 (BC 사용자 확인)', async () => {
    const { act } = await import('@testing-library/react')
    const { canvas, line, getByRole } = shown()
    await tap(canvas, 100)
    act(() => handler(chart.subscribeCrosshairMove)(at('2026-09-16', 102)))
    expect(line()).toHaveTextContent('2026-09-15 · 종가 101.00')
    // ◀ 를 손가락으로 — 화면이 밀려 흉내 마우스가 차트 위에 떨어져도
    const prev = getByRole('button', { name: '이전 거래일' })
    pointer(prev, 'pointerdown', { x: 0, y: 0, t: 5000 })
    pointer(prev, 'pointerup', { x: 0, y: 0, t: 5050 })
    act(() => prev.click())
    act(() => handler(chart.subscribeCrosshairMove)(at('2026-09-16', 102)))
    expect(line()).toHaveTextContent('2026-09-14 · 종가 100.00')
  })

  it('겸용 기기: 손가락 뒤에 마우스를 움직이면 다시 가리킴을 받는다 (끝 검토)', async () => {
    const { act } = await import('@testing-library/react')
    const { canvas, line } = shown()
    await tap(canvas, 0)
    act(() => {
      pointer(canvas, 'pointermove', { x: 150, y: 100, t: 3000, kind: 'mouse' })
      handler(chart.subscribeCrosshairMove)(at('2026-09-15', 101))
    })
    expect(line()).toHaveTextContent('2026-09-15 · 종가 101.00')
  })

  it('마우스로 끌어 민 뒤 떼면 가리킨 날을 고르지 않는다 — 고른 날은 그대로 (끝 검토)', async () => {
    const { act } = await import('@testing-library/react')
    const { canvas, line } = shown()
    await tap(canvas, 0, 100, 0, { kind: 'mouse' })
    chart.setCrosshairPosition.mockClear()
    act(() => {
      pointer(canvas, 'pointerdown', { x: 0, y: 100, t: 1000, kind: 'mouse' })
      pointer(canvas, 'pointermove', { x: 100, y: 100, t: 1100, kind: 'mouse' })
      handler(chart.subscribeCrosshairMove)(at('2026-09-15', 101))
      pointer(canvas, 'pointerup', { x: 100, y: 100, t: 1200, kind: 'mouse' })
      handler(chart.subscribeCrosshairMove)(at(undefined))
    })
    await act(() => new Promise((r) => setTimeout(r, 0)))
    expect(chart.setCrosshairPosition).not.toHaveBeenCalled()
    expect(line()).toHaveTextContent('2026-09-14 · 종가 100.00')
  })

  it('손가락으로 길게 누른 채 밀어 간 날은 뗀 뒤에도 그 날 — ◀ 가 거기서 (BC 사용자 확인)', async () => {
    const { act } = await import('@testing-library/react')
    const { canvas, line } = shown()
    await tap(canvas, 0)
    act(() => {
      pointer(canvas, 'pointerdown', { x: 0, y: 100, t: 1000 })
      // 누르고 있는 동안의 가리킴(라이브러리의 날짜 따라가기)은 받는다
      handler(chart.subscribeCrosshairMove)(at('2026-09-15', 101))
      pointer(canvas, 'pointermove', { x: 100, y: 100, t: 1400 })
      pointer(canvas, 'pointerup', { x: 100, y: 100, t: 1500 })
      // 떼면 라이브러리가 십자선을 지운다
      handler(chart.subscribeCrosshairMove)(at(undefined))
    })
    await act(() => new Promise((r) => setTimeout(r, 0)))
    expect(chart.setCrosshairPosition).toHaveBeenLastCalledWith(101, '2026-09-15', series)
    expect(line()).toHaveTextContent('2026-09-15 · 종가 101.00')
  })

  it('종목·기간을 바꾸면 날짜·값이 같아도 고른 날을 버리고 십자선을 지운다 (사용자 확인)', async () => {
    const { rerender, canvas, line } = shown()
    await tap(canvas, 0)
    const clear = vi.fn()
    ;(chart as unknown as { clearCrosshairPosition: () => void }).clearCrosshairPosition = clear
    rerender(<PriceChart history={{ ...history([]) }} />)
    expect(line()).toHaveTextContent('2026-09-16 · 종가 102.00')
    expect(clear).toHaveBeenCalled()
  })

  it('마우스 왼쪽 클릭도 같은 길', async () => {
    const { canvas, line } = shown()
    await tap(canvas, 100, 100, 0, { kind: 'mouse' })
    expect(line()).toHaveTextContent('2026-09-15 · 종가 101.00')
  })

  it('오른쪽 빈 칸(날이 없는 자리)을 탭하면 마지막 날로 — 오늘로 돌아가는 길', async () => {
    const { canvas, line } = shown()
    await tap(canvas, 0)
    await tap(canvas, 290, 100, 1000)
    expect(chart.setCrosshairPosition).toHaveBeenLastCalledWith(102, '2026-09-16', series)
    expect(line()).toHaveTextContent('2026-09-16 · 종가 102.00')
  })

  it('십자선이 움직이면 그 날, 차트를 떠나면 **고른 날**(없으면 마지막 날)로 돌아간다 (0.45.2 C2)', async () => {
    const { act } = await import('@testing-library/react')
    const { canvas, line } = shown()
    act(() => handler(chart.subscribeCrosshairMove)(at('2026-09-15', 101)))
    expect(line()).toHaveTextContent('2026-09-15 · 종가 101.00')
    act(() => handler(chart.subscribeCrosshairMove)(at(undefined)))
    expect(line()).toHaveTextContent('2026-09-16 · 종가 102.00')

    await tap(canvas, 0)
    act(() => handler(chart.subscribeCrosshairMove)(at('2026-09-15', 101)))
    act(() => handler(chart.subscribeCrosshairMove)(at(undefined)))
    expect(line()).toHaveTextContent('2026-09-14 · 종가 100.00')
  })

  it('◀ ▶ 는 고른 날(없으면 마지막 날)에서 한 거래일씩 — 끝에서는 꺼지지만 포커스는 남는다 (0.45.2 C2)', async () => {
    const { act } = await import('@testing-library/react')
    const userEvent = (await import('@testing-library/user-event')).default
    const user = userEvent.setup()
    const { canvas, line, getByRole } = shown()
    const prev = getByRole('button', { name: '이전 거래일' })
    const next = getByRole('button', { name: '다음 거래일' })
    expect(next).toHaveAttribute('aria-disabled', 'true')
    expect(prev).toHaveAttribute('aria-disabled', 'false')

    await user.click(prev)
    expect(line()).toHaveTextContent('2026-09-15 · 종가 101.00')
    expect(chart.setCrosshairPosition).toHaveBeenLastCalledWith(101, '2026-09-15', series)
    await user.click(prev)
    expect(line()).toHaveTextContent('2026-09-14 · 종가 100.00')
    expect(prev).toHaveAttribute('aria-disabled', 'true')
    await user.click(prev)
    expect(line()).toHaveTextContent('2026-09-14 · 종가 100.00')
    expect(prev).toHaveFocus()

    // PC: 차트를 누른 뒤 마우스가 차트를 떠나 ◀ 로 가도 그 날에서 (계획 검토)
    await tap(canvas, 200, 100, 0, { kind: 'mouse' })
    act(() => handler(chart.subscribeCrosshairMove)(at(undefined)))
    await user.click(prev)
    expect(line()).toHaveTextContent('2026-09-15 · 종가 101.00')
    await user.click(next)
    expect(line()).toHaveTextContent('2026-09-16 · 종가 102.00')
  })

  it('종목을 바꾸면 고른 날을 버리고 새 종목의 마지막 날 (그 날·값이 새 데이터에 없다)', async () => {
    const { canvas, rerender, container } = shown()
    await tap(canvas, 0)
    const other = { ...history([]), ticker: 'QQQ', prices: [{ date: '2026-09-14', close: 300 }, { date: '2026-09-16', close: 310 }] }
    rerender(<PriceChart history={other} />)
    expect(container.querySelector('.chart-readout')).toHaveTextContent('2026-09-16 · 종가 310.00')
  })

  it('"전체 보기"는 사람이 밀거나 키운 뒤에만 — 누르면 처음처럼, 데이터가 바뀌면 내린다 (0.45.2 C3)', async () => {
    const { act } = await import('@testing-library/react')
    const userEvent = (await import('@testing-library/user-event')).default
    const user = userEvent.setup()
    const { canvas, container, rerender } = shown()
    const fit = () => container.querySelector<HTMLButtonElement>('.chart-fit')!
    // 자리는 늘 있다(뜨고 질 때 차트가 밀리지 않게) — 보이지 않을 뿐
    expect(fit().style.visibility).toBe('hidden')
    expect(fit()).toHaveAttribute('aria-hidden', 'true')

    // 길게 누른 뒤 밀기(날짜 따라가기)는 구간을 바꾸지 않는다
    act(() => {
      pointer(canvas, 'pointerdown', { x: 0, y: 100, t: 0 })
      pointer(canvas, 'pointermove', { x: 60, y: 100, t: 400 })
      pointer(canvas, 'pointerup', { x: 60, y: 100, t: 500 })
    })
    expect(fit().style.visibility).toBe('hidden')
    // 세로로 밀기(화면 스크롤)도
    act(() => {
      pointer(canvas, 'pointerdown', { x: 0, y: 100, t: 1000 })
      pointer(canvas, 'pointermove', { x: 5, y: 160, t: 1050 })
      pointer(canvas, 'pointercancel', { x: 5, y: 160, t: 1060 })
    })
    expect(fit().style.visibility).toBe('hidden')

    // 가로로 바로 밀기
    act(() => {
      pointer(canvas, 'pointerdown', { x: 0, y: 100, t: 2000 })
      pointer(canvas, 'pointermove', { x: 60, y: 100, t: 2050 })
      pointer(canvas, 'pointerup', { x: 60, y: 100, t: 2100 })
    })
    expect(fit().style.visibility).toBe('')
    scale.fitContent.mockClear()
    await user.click(fit())
    expect(scale.fitContent).toHaveBeenCalled()
    expect(fit().style.visibility).toBe('hidden')

    // 휠 · 두 손가락
    act(() => {
      canvas.dispatchEvent(new Event('wheel'))
    })
    expect(fit().style.visibility).toBe('')
    rerender(<PriceChart history={{ ...history([]), ticker: 'QQQ' }} />)
    expect(fit().style.visibility).toBe('hidden')
    act(() => {
      pointer(canvas, 'pointerdown', { x: 0, y: 100, t: 3000 })
      pointer(canvas, 'pointerdown', { x: 50, y: 100, t: 3010, id: 2, primary: false })
    })
    expect(fit().style.visibility).toBe('')
  })

  it('마우스는 천천히 끌어도 "전체 보기" — 길게 누르기는 손가락에만 있다 (C 검토)', async () => {
    const { act } = await import('@testing-library/react')
    const { canvas, container } = shown()
    act(() => {
      pointer(canvas, 'pointerdown', { x: 0, y: 100, t: 0, kind: 'mouse' })
      pointer(canvas, 'pointermove', { x: 60, y: 100, t: 600, kind: 'mouse' })
      pointer(canvas, 'pointerup', { x: 60, y: 100, t: 700, kind: 'mouse' })
    })
    expect(container.querySelector<HTMLElement>('.chart-fit')!.style.visibility).toBe('')
  })

  it('마우스로 끌다 차트 밖에서 놓아도 다음 클릭은 그 날로 (C 검토 — 남은 누름이 다음 클릭을 삼켰다)', async () => {
    const { canvas, line } = shown()
    pointer(canvas, 'pointerdown', { x: 0, y: 100, t: 0, kind: 'mouse' })
    pointer(canvas, 'pointermove', { x: 60, y: 100, t: 50, kind: 'mouse' })
    pointer(window as unknown as Element, 'pointerup', { x: 400, y: 100, t: 100, kind: 'mouse' })
    await tap(canvas, 100, 100, 1000, { kind: 'mouse' })
    expect(line()).toHaveTextContent('2026-09-15 · 종가 101.00')
  })

  it('◀ 는 마우스가 가리키는 날이 아니라 고른 날에서 (C 검토)', async () => {
    const { act } = await import('@testing-library/react')
    const userEvent = (await import('@testing-library/user-event')).default
    const user = userEvent.setup()
    const { canvas, line, getByRole } = shown()
    await tap(canvas, 100, 100, 0, { kind: 'mouse' })
    // 고른 날 2026-09-15, 가리키는 날 2026-09-16 (마우스가 차트 위에 있다)
    act(() => handler(chart.subscribeCrosshairMove)(at('2026-09-16', 102)))
    await user.click(getByRole('button', { name: '이전 거래일' }))
    expect(line()).toHaveTextContent('2026-09-14 · 종가 100.00')
  })

  it('"전체 보기"를 누르면 포커스가 옆 ◀ 로 — 숨는 단추에 남아 화면 맨 위로 빠졌다 (C 검토)', async () => {
    const { act } = await import('@testing-library/react')
    const userEvent = (await import('@testing-library/user-event')).default
    const user = userEvent.setup()
    const { canvas, container, getByRole } = shown()
    act(() => {
      canvas.dispatchEvent(new Event('wheel'))
    })
    await user.click(container.querySelector<HTMLButtonElement>('.chart-fit')!)
    expect(getByRole('button', { name: '이전 거래일' })).toHaveFocus()
  })

  it('한 줄의 값은 그 종목의 통화 꼴 — 원화는 소수점 없이', () => {
    const krw = { ...history([]), ticker: '005930.KS', prices: [{ date: '2026-09-15', close: 67_900 }, { date: '2026-09-16', close: 68_000 }] }
    const { line } = shown(krw)
    expect(line()).toHaveTextContent('2026-09-16 · 종가 68,000')
    expect(line().textContent).not.toMatch(/68,000\.00/)
  })

  it('닫으면 구독·듣기를 푼다', () => {
    const { unmount, canvas } = shown()
    const removed = vi.spyOn(canvas, 'removeEventListener')
    unmount()
    expect(chart.unsubscribeCrosshairMove).toHaveBeenCalled()
    expect(removed.mock.calls.map(([type]) => type).sort()).toEqual(['pointercancel', 'pointerdown', 'pointermove', 'pointerup', 'wheel'])
    // 창에 단 것도 (차트 밖에서 놓은 마우스)
    const onWindow = vi.spyOn(window, 'removeEventListener')
    const second = shown()
    second.unmount()
    expect(onWindow.mock.calls.map(([type]) => type)).toEqual(expect.arrayContaining(['pointerdown', 'pointermove', 'pointerup', 'pointercancel']))
    // 손가락 종류를 보는 창 듣기(capture)도 다 푼다 — 붙인 만큼
    const added = vi.spyOn(window, 'addEventListener')
    const third = shown()
    const capture = (calls: unknown[][]) => calls.filter(([, , o]) => o === true).map(([type]) => type).sort()
    const attached = capture(added.mock.calls)
    onWindow.mockClear()
    third.unmount()
    expect(attached).toEqual(['pointercancel', 'pointerdown', 'pointermove', 'pointerup'])
    expect(capture(onWindow.mock.calls)).toEqual(attached)
  })
})
