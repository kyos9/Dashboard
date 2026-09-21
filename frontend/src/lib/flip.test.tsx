import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { shifts, useReorderAnimation, type Spot } from './flip'

describe('자리가 얼마나 움직였나', () => {
  const before = new Map<string, Spot>([
    ['A', { key: 'A', top: 0, left: 0 }],
    ['B', { key: 'B', top: 40, left: 0 }],
  ])

  it('바뀐 만큼의 거리를 옛 자리 방향으로 준다', () => {
    const moved = shifts(before, [
      { key: 'A', top: 40, left: 0 },
      { key: 'B', top: 0, left: 0 },
    ])
    expect(moved).toEqual([
      { key: 'A', dx: 0, dy: -40 },
      { key: 'B', dx: 0, dy: 40 },
    ])
  })

  it('제자리인 항목은 빼놓는다', () => {
    expect(shifts(before, [{ key: 'A', top: 0, left: 0 }])).toEqual([])
  })

  it('1px 미만은 이동이 아니라 반올림이다', () => {
    expect(shifts(before, [{ key: 'A', top: 0.4, left: 0 }])).toEqual([])
  })

  it('새로 생긴 항목은 움직이지 않는다 — 어디서 왔는지 알 수 없다', () => {
    expect(shifts(before, [{ key: 'C', top: 80, left: 0 }])).toEqual([])
  })
})

/** jsdom은 레이아웃을 하지 않는다 — 행 높이 40px짜리 목록인 척한다 */
function fakeLayout(order: () => string[]) {
  const spy = vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    const key = this.dataset.flipKey
    const index = key ? order().indexOf(key) : -1
    return index === -1 ? 0 : index * 40
  })
  return spy
}

function List({ order, paused = false }: { order: string[]; paused?: boolean }) {
  const ref = useReorderAnimation<HTMLDivElement>(order.join(), paused)
  return (
    <div ref={ref}>
      {order.map((key) => (
        <div key={key} data-flip-key={key}>
          {key}
        </div>
      ))}
    </div>
  )
}

describe('순서가 바뀌면 미끄러진다', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('자리를 바꾼 항목만, 옛 자리에서 새 자리로 움직인다', () => {
    let order = ['A', 'B']
    fakeLayout(() => order)
    const animate = vi.fn()
    // jsdom에는 Element.animate가 없다 — 불렸는지만 본다
    Object.defineProperty(HTMLElement.prototype, 'animate', {
      value: animate,
      configurable: true,
      writable: true,
    })

    const { rerender } = render(<List order={order} />)
    expect(animate).not.toHaveBeenCalled()

    order = ['B', 'A']
    rerender(<List order={order} />)

    expect(animate).toHaveBeenCalledTimes(2)
    const frames = animate.mock.calls.map((call) => call[0][0].transform)
    // A는 40px 위에 있던 것처럼 시작해서 제자리로, B는 그 반대
    expect(frames).toContain('translate(0px, -40px)')
    expect(frames).toContain('translate(0px, 40px)')
  })

  it('끄는 동안에는 자리만 바꾸고 움직이지 않는다', () => {
    // 끌어놓기 중에 transform 애니메이션을 걸면 크롬이 그 끌기를 취소해버린다
    // (drop 이벤트가 아예 오지 않아 순서가 저장되지 않는다)
    let order = ['A', 'B']
    fakeLayout(() => order)
    const animate = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'animate', {
      value: animate,
      configurable: true,
      writable: true,
    })

    const { rerender } = render(<List order={order} paused />)
    order = ['B', 'A']
    rerender(<List order={order} paused />)

    expect(animate).not.toHaveBeenCalled()
  })

  it('순서가 그대로면 움직이지 않는다 (값만 바뀐 새로고침)', () => {
    const order = ['A', 'B']
    fakeLayout(() => order)
    const animate = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'animate', {
      value: animate,
      configurable: true,
      writable: true,
    })

    const { rerender } = render(<List order={order} />)
    rerender(<List order={[...order]} />)

    expect(animate).not.toHaveBeenCalled()
  })
})
