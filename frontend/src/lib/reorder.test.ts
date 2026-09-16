import { describe, expect, it } from 'vitest'
import { moveOne, moveTo } from './reorder'

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
  it('아래로 끌면 놓은 행 뒤에 들어간다', () => {
    expect(moveTo(ALL, 'A', 'C')).toEqual(['B', 'C', 'A', 'D'])
  })

  it('위로 끌면 놓은 행 앞에 들어간다', () => {
    expect(moveTo(ALL, 'D', 'B')).toEqual(['A', 'D', 'B', 'C'])
  })

  it('제자리에 놓으면 그대로', () => {
    expect(moveTo(ALL, 'B', 'B')).toEqual(ALL)
  })

  it('목록에 없는 항목은 무시한다', () => {
    expect(moveTo(ALL, 'Z', 'B')).toEqual(ALL)
    expect(moveTo(ALL, 'B', 'Z')).toEqual(ALL)
  })

  it('맨 끝으로 끌 수 있다', () => {
    expect(moveTo(ALL, 'A', 'D')).toEqual(['B', 'C', 'D', 'A'])
    expect(moveTo(ALL, 'D', 'A')).toEqual(['D', 'A', 'B', 'C'])
  })
})
