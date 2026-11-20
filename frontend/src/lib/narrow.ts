import { useSyncExternalStore } from 'react'

/**
 * 폰 배치를 쓰는 폭 — 헤더 한 줄 + 아래 탭 (ROADMAP 8-2). index.css 의 `@media (max-width: 720px)` 와 같다.
 *
 * CSS 로 숨기지 않고 그리는 것 자체를 가른다. 둘 다 그려두고 한쪽을 숨기면 같은 버튼이 두 벌
 * 생기고, 화면 읽기 프로그램·테스트가 어느 쪽을 누를지 모른다.
 */
export const NARROW_QUERY = '(max-width: 720px)'

function query(): MediaQueryList | null {
  // matchMedia 는 테스트 환경(jsdom)에 없다 — 없으면 PC 배치
  return typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(NARROW_QUERY) : null
}

function subscribe(onChange: () => void): () => void {
  const list = query()
  if (!list) return () => {}
  list.addEventListener('change', onChange)
  return () => list.removeEventListener('change', onChange)
}

function snapshot(): boolean {
  return query()?.matches ?? false
}

/** 지금 폰 배치인가. 창 폭이 바뀌면(폰을 눕히면) 따라 바뀐다. */
export function useNarrow(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false)
}

/**
 * 아무 폭 질의나 — 리밸런싱 PC 표(6열)는 본문이 좁으면(확대 150% 등) 오른쪽 열이 잘려
 * 그 폭에서는 폰과 같은 줄 묶음으로 그린다 (디자인 4차 묶음 4 사용자 확인). 테스트 환경(jsdom)에서는 늘 거짓.
 */
export function useMedia(media: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(media) : null
      if (!list) return () => {}
      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    },
    () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(media).matches : false),
    () => false,
  )
}
