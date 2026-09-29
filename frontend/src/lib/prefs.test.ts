import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// `?raw` 는 파일을 글자 그대로 읽어온다 — 배포되는 바로 그 index.html 이어야 뜻이 있다
import INDEX_HTML from '../../index.html?raw'
import { amount, qty, signedAmount } from './display'
import {
  HIDE_AMOUNTS_KEY,
  OLD_THEME_KEY,
  RISE_KEY,
  THEME_KEY,
  initPrefs,
  resetPrefs,
  setHideAmounts,
  setRise,
  setThemeChoice,
  usePrefs,
} from './prefs'

/** 기기의 테마를 흉내 낸다. 'none' 이면 matchMedia 가 없는 브라우저 */
function pretendSystem(scheme: 'light' | 'dark' | 'none') {
  const listeners = new Set<() => void>()
  let current = scheme
  if (scheme === 'none') {
    vi.stubGlobal('matchMedia', undefined)
    return { set: () => {} }
  }
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      return query.includes(current === 'none' ? '--' : current)
    },
    media: query,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  }))
  return {
    set(next: 'light' | 'dark') {
      current = next
      listeners.forEach((fn) => fn())
    },
  }
}

const root = () => document.documentElement

beforeEach(() => {
  localStorage.clear()
  resetPrefs()
  document.head.innerHTML = '<meta name="theme-color" content="#0a0e14" />'
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('테마 — 고르기 전에는 기기 설정', () => {
  it('기기가 밝으면 밝게, 어두우면 어둡게', () => {
    pretendSystem('light')
    initPrefs()
    expect(root().dataset.theme).toBe('light')

    resetPrefs()
    pretendSystem('dark')
    initPrefs()
    expect(root().dataset.theme).toBe('dark')
  })

  it('기기 설정을 모르는 브라우저는 어둡게 — 원래 모습', () => {
    pretendSystem('none')
    initPrefs()
    expect(root().dataset.theme).toBe('dark')
  })

  it('기기 설정이 바뀌면 따라간다 — 고르기 전까지만', () => {
    const system = pretendSystem('dark')
    const { result } = renderHook(() => usePrefs())
    expect(result.current.theme).toBe('dark')
    act(() => system.set('light'))
    expect(result.current.theme).toBe('light')
    expect(root().dataset.theme).toBe('light')

    act(() => setThemeChoice('dark'))
    act(() => system.set('light'))
    expect(result.current.theme).toBe('dark')
    expect(root().dataset.theme).toBe('dark')
  })

  it('고른 것은 기억하고 기기 설정보다 앞선다', () => {
    pretendSystem('light')
    setThemeChoice('dark')
    expect(localStorage.getItem(THEME_KEY)).toBe('dark')

    resetPrefs()
    initPrefs()
    expect(root().dataset.theme).toBe('dark')
  })

  it('"기기 설정"을 다시 고르면 기억을 지운다 — 옛 키까지', () => {
    pretendSystem('light')
    localStorage.setItem(OLD_THEME_KEY, 'light')
    setThemeChoice('dark')
    setThemeChoice('system')
    expect(localStorage.getItem(THEME_KEY)).toBeNull()
    expect(localStorage.getItem(OLD_THEME_KEY)).toBeNull()
    expect(root().dataset.theme).toBe('light')
  })

  it('예전 앱에서 밝게를 골랐던 사람은 밝게 남는다. 예전의 "dark" 는 고른 것인지 몰라 기기 설정을 따른다', () => {
    pretendSystem('dark')
    localStorage.setItem(OLD_THEME_KEY, 'light')
    initPrefs()
    expect(root().dataset.theme).toBe('light')

    resetPrefs()
    pretendSystem('light')
    localStorage.setItem(OLD_THEME_KEY, 'dark')
    initPrefs()
    expect(root().dataset.theme).toBe('light')
  })

  it('주소창 색도 테마를 따른다', () => {
    pretendSystem('dark')
    initPrefs()
    const meta = document.querySelector('meta[name="theme-color"]')!
    // jsdom 은 CSS 파일을 읽지 않아 --bg 가 비어 있다 — 비어 있으면 건드리지 않는다
    expect(meta.getAttribute('content')).toBe('#0a0e14')
  })
})

describe('상승 색', () => {
  it('기본은 초록, 빨강을 고르면 기억한다', () => {
    pretendSystem('dark')
    initPrefs()
    expect(root().dataset.rise).toBe('green')

    setRise('red')
    expect(root().dataset.rise).toBe('red')
    expect(localStorage.getItem(RISE_KEY)).toBe('red')

    resetPrefs()
    initPrefs()
    expect(root().dataset.rise).toBe('red')
  })

  it('모르는 값이면 초록', () => {
    pretendSystem('dark')
    localStorage.setItem(RISE_KEY, 'purple')
    initPrefs()
    expect(root().dataset.rise).toBe('green')
  })
})

describe('금액 가리기 (9-3)', () => {
  it('기본은 보인다. 켜면 금액·수량이 ••••• 가 되고, 기억했다가 다시 켜도 가려져 있다', () => {
    pretendSystem('dark')
    const { result } = renderHook(() => usePrefs())
    expect(result.current.hideAmounts).toBe(false)
    expect(amount(1_234_567, 'KRW')).toBe('₩1,234,567')

    act(() => setHideAmounts(true))
    expect(result.current.hideAmounts).toBe(true)
    expect(localStorage.getItem(HIDE_AMOUNTS_KEY)).toBe('1')
    expect(amount(1_234_567, 'KRW')).toBe('•••••')
    expect(signedAmount(-500, 'USD')).toBe('•••••')
    expect(qty(12.5)).toBe('•••••')
    // 모르는 값은 가릴 것도 없다 — "—" 그대로
    expect(amount(null, 'KRW')).toBe('—')

    resetPrefs()
    renderHook(() => usePrefs())
    expect(amount(1, 'KRW')).toBe('•••••')

    act(() => setHideAmounts(false))
    expect(localStorage.getItem(HIDE_AMOUNTS_KEY)).toBeNull()
    expect(amount(1_234_567, 'KRW')).toBe('₩1,234,567')
  })

  it('resetPrefs 는 가린 상태도 풀어 둔다 — 다음 테스트로 새지 않게', () => {
    pretendSystem('dark')
    renderHook(() => usePrefs())
    act(() => setHideAmounts(true))
    expect(amount(1, 'KRW')).toBe('•••••')
    resetPrefs()
    // 가게를 다시 읽기 전에 그리는 곳(표시 함수만 쓰는 곳)도 가려지지 않는다
    expect(amount(1, 'KRW')).toBe('₩1')
  })

  it('"1" 말고는 가리지 않는다', () => {
    pretendSystem('dark')
    localStorage.setItem(HIDE_AMOUNTS_KEY, 'true')
    const { result } = renderHook(() => usePrefs())
    expect(result.current.hideAmounts).toBe(false)
  })
})

describe('저장이 막힌 브라우저(사생활 보호 창)', () => {
  it('고른 것은 지금 화면에 바로 적용된다 — 기억만 못 한다', () => {
    pretendSystem('dark')
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    initPrefs()
    expect(root().dataset.theme).toBe('dark')
    setThemeChoice('light')
    setRise('red')
    expect(root().dataset.theme).toBe('light')
    expect(root().dataset.rise).toBe('red')
    vi.restoreAllMocks()
  })
})

/**
 * index.html 의 스크립트는 React 보다 먼저 같은 일을 한다. 둘이 다르면 첫 그림과 그다음 그림이
 * 달라 화면이 한 번 번쩍인다. 같은 조건에서 둘이 같은 답을 내는지 본다.
 */
describe('첫 그림 스크립트(index.html)와 같은 규칙', () => {
  const script = INDEX_HTML.match(/<script>([\s\S]*?)<\/script>/)![1]

  const cases: { name: string; system: 'light' | 'dark' | 'none'; store: Record<string, string> }[] = [
    { name: '아무것도 안 고름 · 기기 밝게', system: 'light', store: {} },
    { name: '아무것도 안 고름 · 기기 어둡게', system: 'dark', store: {} },
    { name: '기기 설정을 모름', system: 'none', store: {} },
    { name: '어둡게 고름 · 기기 밝게', system: 'light', store: { [THEME_KEY]: 'dark' } },
    { name: '밝게 고름 · 기기 어둡게', system: 'dark', store: { [THEME_KEY]: 'light' } },
    { name: '예전 밝게', system: 'dark', store: { [OLD_THEME_KEY]: 'light' } },
    { name: '예전 dark', system: 'light', store: { [OLD_THEME_KEY]: 'dark' } },
    { name: '상승 빨강', system: 'dark', store: { [RISE_KEY]: 'red' } },
    { name: '이상한 값', system: 'light', store: { [THEME_KEY]: 'blue', [RISE_KEY]: 'x' } },
  ]

  it.each(cases)('$name', ({ system, store }) => {
    pretendSystem(system)
    Object.entries(store).forEach(([k, v]) => localStorage.setItem(k, v))

    new Function(script)()
    const early = { theme: root().dataset.theme, rise: root().dataset.rise }
    root().removeAttribute('data-theme')
    root().removeAttribute('data-rise')

    resetPrefs()
    initPrefs()
    expect(early).toEqual({ theme: root().dataset.theme, rise: root().dataset.rise })
  })
})
