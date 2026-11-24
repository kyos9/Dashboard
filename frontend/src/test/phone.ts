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

/**
 * 폭 1100 이하 PC 흉내 — 머리줄은 PC 그대로, 리밸런싱 · 매크로 · 설정만 예전(목록 + 창) 배치로 그린다.
 * 설정 탭을 여는 예전 시험들이 쓴다 (디자인 5차 목업 08 가 — PC 설정은 왼쪽 메뉴 + 오른쪽 내용).
 */
export function pretendMidWidth() {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (media: string) => ({
      matches: media === '(max-width: 1100px)',
      media,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  })
}
