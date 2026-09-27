import { act } from '@testing-library/react'
import { NARROW_QUERY } from '../lib/narrow'

/**
 * 폰 폭 흉내 — jsdom 에는 matchMedia 가 없어서 늘 PC 배치로 그린다.
 * `setWidth(false)` 로 창을 넓힌 것처럼 바꿀 수 있다 (폰을 눕힌 경우).
 */
export function pretendPhone() {
  let narrow = true
  const listeners = new Set<() => void>()
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (media: string) => ({
      get matches() {
        return media === NARROW_QUERY && narrow
      },
      media,
      onchange: null,
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  })
  return {
    setNarrow(next: boolean) {
      narrow = next
      act(() => listeners.forEach((fn) => fn()))
    },
  }
}

export function forgetPhone() {
  Reflect.deleteProperty(window, 'matchMedia')
}
