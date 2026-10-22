import { beforeEach, expect, it } from 'vitest'
import { lockBodyScroll, resetScrollLock } from './scrollLock'

beforeEach(() => {
  resetScrollLock()
  document.body.style.overflow = ''
})

it('마지막이 풀 때 처음 값으로 — 푸는 순서와 상관없다', () => {
  const outer = lockBodyScroll()
  const inner = lockBodyScroll()
  outer() // 바깥이 먼저 정리돼도
  expect(document.body.style.overflow).toBe('hidden')
  inner()
  expect(document.body.style.overflow).toBe('')
})

it('같은 것을 두 번 풀어도 한 번', () => {
  const a = lockBodyScroll()
  const b = lockBodyScroll()
  a()
  a()
  expect(document.body.style.overflow).toBe('hidden')
  b()
  expect(document.body.style.overflow).toBe('')
})

it('처음부터 걸려 있던 값은 그대로 돌려놓는다', () => {
  document.body.style.overflow = 'clip'
  const a = lockBodyScroll()
  expect(document.body.style.overflow).toBe('hidden')
  a()
  expect(document.body.style.overflow).toBe('clip')
})
