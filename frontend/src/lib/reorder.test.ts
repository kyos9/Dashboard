import { describe, expect, it } from 'vitest'
import { isEdge, moveOne } from './reorder'

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

describe('끝 판정', () => {
  it('보이는 목록 기준으로 판단한다', () => {
    expect(isEdge(['A', 'C'], 'A', 'up')).toBe(true)
    expect(isEdge(['A', 'C'], 'A', 'down')).toBe(false)
    expect(isEdge(['A', 'C'], 'C', 'down')).toBe(true)
  })

  it('목록에 없으면 움직일 수 없는 것으로 본다', () => {
    expect(isEdge(['A'], 'Z', 'up')).toBe(true)
    expect(isEdge(['A'], 'Z', 'down')).toBe(true)
  })
})
