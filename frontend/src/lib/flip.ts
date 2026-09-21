import { useLayoutEffect, useRef } from 'react'

/** 움직임이 눈에 남을 만큼은 길고, 다음 조작을 막지 않을 만큼은 짧게 */
const DURATION_MS = 180

export interface Spot {
  key: string
  top: number
  left: number
}

export interface Shift {
  key: string
  dx: number
  dy: number
}

/**
 * 자리가 바뀐 항목과, 그 항목이 "원래 있던 자리"까지의 거리.
 *
 * 새 자리로 이미 그려진 뒤에 옛 자리로 되돌려놓고 원위치로 보내면(FLIP), 브라우저는
 * 한 번만 그리면서도 사람 눈에는 미끄러져 이동한 것처럼 보인다.
 *
 * 1px 미만은 버린다 — 반올림 때문에 생기는 흔들림이지 이동이 아니다.
 */
export function shifts(before: Map<string, Spot>, after: Spot[]): Shift[] {
  const moved: Shift[] = []
  for (const spot of after) {
    const from = before.get(spot.key)
    if (!from) continue
    const dx = from.left - spot.left
    const dy = from.top - spot.top
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue
    moved.push({ key: spot.key, dx, dy })
  }
  return moved
}

function motionAllowed(): boolean {
  // matchMedia는 테스트 환경(jsdom)에 없다. 없으면 "줄이라는 요청이 없는 것"으로 본다.
  if (typeof window === 'undefined') return false
  return !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

/**
 * 순서가 바뀌면 항목들이 새 자리로 미끄러져 가게 한다.
 *
 * 순서를 바꿨는데 행이 그냥 툭 바뀌어 있으면, 무엇이 어디로 갔는지 눈으로 좇을 수
 * 없어서 매번 다시 읽어야 한다. 움직임 자체가 "이게 거기로 갔다"는 설명이다.
 *
 * `signature`(현재 순서)가 바뀐 렌더에서만 움직인다. 값이 갱신되거나 필터가 바뀌어
 * 행이 밀리는 것까지 애니메이션으로 만들면 화면이 쉴 새 없이 흔들린다.
 *
 * `paused`는 브라우저가 끌어놓기를 진행하는 동안 켠다. 끄는 도중에 transform
 * 애니메이션을 걸면 **크롬이 그 끌기를 취소해버려서 drop 이벤트가 아예 오지 않는다**
 * (실제 브라우저에서 확인했다. 끌던 행이 아니라 옆 행만 움직여도, CSS transition으로
 * 해도 똑같이 취소된다). 그래서 끄는 동안에는 자리만 즉시 바꾸고, 미끄러뜨리는 것은
 * 키보드로 옮길 때처럼 끌기가 아닌 경우에만 한다.
 *
 * 돌려주는 ref를 목록을 감싸는 요소에 달고, 각 항목에 `data-flip-key`를 준다.
 */
export function useReorderAnimation<T extends HTMLElement>(signature: string, paused = false) {
  const container = useRef<T>(null)
  const spots = useRef(new Map<string, Spot>())
  const previousSignature = useRef(signature)

  // 그려진 뒤 · 브라우저가 화면에 칠하기 전에 재야 한다 → useEffect가 아니라 layout
  useLayoutEffect(() => {
    const root = container.current
    if (!root) return

    const nodes = Array.from(root.querySelectorAll<HTMLElement>('[data-flip-key]'))
    // offsetTop은 스크롤과 무관하다. 화면 좌표로 재면 목록을 스크롤한 것까지
    // "이동"으로 잡혀서 엉뚱한 거리를 움직인다.
    const now: Spot[] = nodes.map((node) => ({
      key: node.dataset.flipKey ?? '',
      top: node.offsetTop,
      left: node.offsetLeft,
    }))

    const reordered = previousSignature.current !== signature
    previousSignature.current = signature

    if (reordered && !paused && motionAllowed()) {
      const byKey = new Map(nodes.map((node) => [node.dataset.flipKey ?? '', node]))
      for (const { key, dx, dy } of shifts(spots.current, now)) {
        const node = byKey.get(key)
        // animate는 jsdom에 없다 — 없으면 애니메이션만 건너뛴다
        if (!node || typeof node.animate !== 'function') continue
        node.animate(
          [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
          { duration: DURATION_MS, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
        )
      }
    }

    spots.current = new Map(now.map((spot) => [spot.key, spot]))
  })

  return container
}
