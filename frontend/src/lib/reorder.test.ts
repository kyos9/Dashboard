import { describe, expect, it } from 'vitest'
import { dropSide, moveOne, placeAt } from './reorder'

const ALL = ['A', 'B', 'C', 'D']

describe('한 칸 옮기기', () => {
  it('위로 한 칸', () => {
    expect(moveOne(ALL, ALL, 'C', 'up')).toEqual(['A', 'C', 'B', 'D'])
  })

  it('아래로 한 칸', () => {
    expect(moveOne(ALL, ALL, 'B', 'down')).toEqual(['A', 'C', 'B', 'D'])
  })

  it('맨 위에서 더 올리면 그대로', () => {
    expect(moveOne(ALL, ALL, 'A', 'up')).toEqual(ALL)
  })

  it('맨 아래에서 더 내리면 그대로', () => {
    expect(moveOne(ALL, ALL, 'D', 'down')).toEqual(ALL)
  })
})

describe('필터가 걸려 있을 때', () => {
  // 화면에는 A, C만 보이고 B, D는 필터에 걸려 숨어 있다
  const VISIBLE = ['A', 'C']

  it('보이는 이웃과 자리를 바꾼다', () => {
    // 전체에서 그냥 한 칸 올리면 C가 숨어 있는 B와 바뀌어, 화면상으로는
    // 아무 일도 일어나지 않은 것처럼 보인다
    expect(moveOne(ALL, VISIBLE, 'C', 'up')).toEqual(['C', 'A', 'B', 'D'])
  })

  it('숨은 항목들의 상대 순서는 유지된다', () => {
    const moved = moveOne(ALL, VISIBLE, 'A', 'down')
    expect(moved).toEqual(['B', 'C', 'A', 'D'])
    // B는 여전히 C보다 앞, D는 여전히 마지막
    expect(moved.indexOf('B')).toBeLessThan(moved.indexOf('C'))
    expect(moved[moved.length - 1]).toBe('D')
  })

  it('보이는 목록의 끝이면 움직이지 않는다', () => {
    expect(moveOne(ALL, VISIBLE, 'C', 'down')).toEqual(ALL)
    expect(moveOne(ALL, VISIBLE, 'A', 'up')).toEqual(ALL)
  })
})

describe('끌어다 놓기', () => {
  it('놓은 행 뒤에 넣는다', () => {
    expect(placeAt(ALL, 'A', 'C', 'after')).toEqual(['B', 'C', 'A', 'D'])
  })

  it('놓은 행 앞에 넣는다', () => {
    expect(placeAt(ALL, 'D', 'B', 'before')).toEqual(['A', 'D', 'B', 'C'])
  })

  it('맨 끝·맨 앞으로 보낼 수 있다', () => {
    expect(placeAt(ALL, 'A', 'D', 'after')).toEqual(['B', 'C', 'D', 'A'])
    expect(placeAt(ALL, 'D', 'A', 'before')).toEqual(['D', 'A', 'B', 'C'])
  })

  it('제자리면 원래 배열을 그대로 돌려준다', () => {
    // 끄는 동안 매 순간 호출되므로, 바뀐 게 없으면 새 배열을 만들면 안 된다
    // (만들면 화면 전체가 계속 다시 그려진다)
    expect(placeAt(ALL, 'B', 'B', 'after')).toBe(ALL)
    expect(placeAt(ALL, 'A', 'B', 'before')).toBe(ALL)
    expect(placeAt(ALL, 'B', 'A', 'after')).toBe(ALL)
  })

  it('목록에 없는 항목은 무시한다', () => {
    expect(placeAt(ALL, 'Z', 'B', 'after')).toEqual(ALL)
    expect(placeAt(ALL, 'B', 'Z', 'after')).toEqual(ALL)
  })
})

describe('어느 쪽에 놓을지', () => {
  const ROW = { top: 100, left: 0, width: 800, height: 40 }

  it('세로 목록은 행의 절반을 넘겨야 뒤로 간다', () => {
    expect(dropSide(ROW, { x: 400, y: 105 }, false)).toBe('before')
    expect(dropSide(ROW, { x: 400, y: 135 }, false)).toBe('after')
  })

  it('절반에 걸치면 앞으로 — 커서가 떨릴 때 자리가 튀지 않게', () => {
    expect(dropSide(ROW, { x: 400, y: 120 }, false)).toBe('before')
  })

  it('가로로 늘어선 목록은 좌우로 가른다', () => {
    const card = { top: 0, left: 200, width: 300, height: 260 }
    expect(dropSide(card, { x: 250, y: 900 }, true)).toBe('before')
    expect(dropSide(card, { x: 480, y: 900 }, true)).toBe('after')
  })
})
