import { useEffect, useRef, type RefObject } from 'react'
import { useBackToClose } from './backToClose'

/**
 * 헤더 메뉴·더보기처럼 버튼 아래로 펼치는 작은 판을 닫는 규칙 (ROADMAP 8-2).
 *
 * - **바깥을 누르면 닫힌다.** 여는 버튼도 `wrap` 안에 있으므로, 버튼을 다시 누르면 버튼이 닫는다
 *   (여기서 닫고 버튼이 다시 여는 일이 없다).
 * - **Esc 로 닫고, 초점을 여는 버튼으로 돌려준다.** 키보드로 쓰는 사람이 제자리를 잃지 않게.
 * - **폰의 뒤로가기로 닫힌다** (6-2 팝업과 같은 규칙). 판만 닫히고 보던 탭은 그대로다.
 *
 * 판이 열려 있는 동안만 부른다 — 판 컴포넌트 안에서 쓴다.
 */
export function usePopoverClose(
  wrap: RefObject<HTMLElement | null>,
  toggle: RefObject<HTMLElement | null>,
  onClose: () => void,
) {
  useBackToClose(onClose)
  const latest = useRef(onClose)
  useEffect(() => {
    latest.current = onClose
  })

  useEffect(() => {
    const onPointer = (e: Event) => {
      if (wrap.current && e.target instanceof Node && !wrap.current.contains(e.target)) latest.current()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      latest.current()
      toggle.current?.focus()
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [wrap, toggle])
}
