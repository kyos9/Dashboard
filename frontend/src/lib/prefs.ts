import { useSyncExternalStore } from 'react'

/**
 * 화면 설정 — 테마와 상승 색 (ROADMAP 8-4).
 *
 * 둘 다 **이 기기의** 편의라 기기에 적는다(서버에 적지 않는다). 손님도 쓸 수 있고, 로그인
 * 전 첫 그림부터 맞아야 한다 — index.html 의 작은 스크립트가 React 보다 먼저 같은 값을 읽어
 * `<html>` 에 붙인다. 여기와 그 스크립트가 **같은 키·같은 규칙**을 써야 한다(테스트가 본다).
 *
 * - 테마: 고르기 전에는 기기 설정(`prefers-color-scheme`)을 따른다. 한 번 고르면 고른 것.
 *   "기기 설정 따르기"를 다시 고르면 기억을 지운다.
 * - 상승 색: 초록(기본) 또는 빨강. 빨강이면 하락은 파랑이다(한국 증권 앱 방식).
 *   가격 등락·수익률·평가손익만 따른다 — 시그널 색(매수 초록·매도 빨강)은 그대로다.
 */

export type ThemeChoice = 'system' | 'light' | 'dark'
export type Theme = 'light' | 'dark'
export type Rise = 'green' | 'red'

export const THEME_KEY = 'dashboard.theme'
export const RISE_KEY = 'dashboard.rise'
/** 8-4 전의 키. 예전 앱은 켤 때마다 'dark' 를 적었으므로 'dark' 는 고른 것인지 알 수 없다 —
 * 'light' 만 사람이 고른 것으로 인정한다. */
export const OLD_THEME_KEY = 'signalboard.theme'

const DARK_QUERY = '(prefers-color-scheme: dark)'

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // 기억 못 해도 지금 화면은 바뀐다
  }
}

export function readThemeChoice(): ThemeChoice {
  const saved = read(THEME_KEY)
  if (saved === 'light' || saved === 'dark') return saved
  if (read(OLD_THEME_KEY) === 'light') return 'light'
  return 'system'
}

export function readRise(): Rise {
  return read(RISE_KEY) === 'red' ? 'red' : 'green'
}

function darkQuery(): MediaQueryList | null {
  return typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(DARK_QUERY) : null
}

/** 기기가 밝은 테마인가. 알 수 없으면(오래된 브라우저·테스트) 어둡게 — 이 앱의 원래 모습 */
function systemTheme(): Theme {
  const list = darkQuery()
  if (!list) return 'dark'
  return list.matches ? 'dark' : window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

export function resolveTheme(choice: ThemeChoice): Theme {
  return choice === 'system' ? systemTheme() : choice
}

/* ---------- 가게 ----------
   헤더·화면 설정 팝업·차트가 같은 값을 본다. */

interface Prefs {
  choice: ThemeChoice
  theme: Theme
  rise: Rise
}

let current: Prefs | null = null
const listeners = new Set<() => void>()

function load(): Prefs {
  const choice = readThemeChoice()
  return { choice, theme: resolveTheme(choice), rise: readRise() }
}

function get(): Prefs {
  if (!current) current = load()
  return current
}

/** `<html>` 에 붙이고, 폰의 주소창·상태바 색을 배경에 맞춘다 */
export function applyPrefs(prefs: { theme: Theme; rise: Rise }) {
  const root = document.documentElement
  root.setAttribute('data-theme', prefs.theme)
  root.setAttribute('data-rise', prefs.rise)
  // index.css 의 --bg 를 그대로 읽는다 — 색을 여기에 또 적으면 언젠가 둘이 어긋난다
  const meta = document.querySelector('meta[name="theme-color"]')
  const bg = getComputedStyle(root).getPropertyValue('--bg').trim()
  if (meta && bg) meta.setAttribute('content', bg)
}

function set(next: Prefs) {
  current = next
  applyPrefs(next)
  listeners.forEach((fn) => fn())
}

export function setThemeChoice(choice: ThemeChoice) {
  write(THEME_KEY, choice === 'system' ? null : choice)
  // 옛 키는 지운다 — 남아 있으면 "기기 설정 따르기"를 골라도 다음에 밝게로 돌아온다
  write(OLD_THEME_KEY, null)
  set({ ...get(), choice, theme: resolveTheme(choice) })
}

export function setRise(rise: Rise) {
  write(RISE_KEY, rise)
  set({ ...get(), rise })
}

function onSystemChange() {
  const prefs = get()
  if (prefs.choice === 'system') set({ ...prefs, theme: systemTheme() })
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange)
  const list = darkQuery()
  if (listeners.size === 1) list?.addEventListener('change', onSystemChange)
  return () => {
    listeners.delete(onChange)
    if (listeners.size === 0) list?.removeEventListener('change', onSystemChange)
  }
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(subscribe, get, get)
}

/** 시작할 때 한 번 — index.html 스크립트가 이미 붙였어도 같은 값이다(주소창 색까지 맞춘다) */
export function initPrefs() {
  applyPrefs(get())
}

/** 테스트용 — 저장소를 바꾼 뒤 다시 읽게 한다 */
export function resetPrefs() {
  current = null
}
