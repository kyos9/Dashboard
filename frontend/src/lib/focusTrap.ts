import { useEffect, type RefObject } from 'react'

/**
 * 팝업(dialog) 안에서만 Tab 이 돈다 — 밖으로 새면 키보드로 뒤 화면을 누르게 된다 (디자인 2차 검토, DESIGN_PROMPT 3-1).
 * 열면 포커스를 팝업으로(또는 `initial`), 닫으면 연 자리로 돌려준다.
 * 차트 팝업에서 쓰던 것을 묶음 3 의 추가 시트도 쓰게 꺼냈다(검토 조건 3).
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, initial?: () => HTMLElement | null | undefined) {
  useEffect(() => {
    const focusables = () =>
      Array.from(
        ref.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((el) => !el.closest('[hidden], [aria-hidden="true"]'))
    const onTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !ref.current) return
      // 안쪽에 또 연 팝업이 있으면 그쪽이 가둔다
      if (isCovered(ref.current)) return
      const items = focusables()
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement as HTMLElement | null
      const inside = !!active && ref.current.contains(active)
      if (e.shiftKey && (!inside || active === first)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (!inside || active === last)) {
        e.preventDefault()
        first.focus()
      }
    }
    const opener = document.activeElement as HTMLElement | null
    const start = initial?.() ?? ref.current
    start?.focus({ preventScroll: true })
    document.addEventListener('keydown', onTab)
    return () => {
      document.removeEventListener('keydown', onTab)
      opener?.focus?.()
    }
    // 열 때 한 번
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}

/**
 * 이 팝업 위(안쪽)에 다른 팝업이 떠 있나 — 보유 탭의 "한 번에 수정"·삭제 확인창이 차트 팝업 안에 뜬다.
 * 그때 Esc · Tab 은 맨 위 팝업만 받는다(검토 조건 2: Esc 한 번에 셋이 다 닫혔다).
 */
export function isCovered(dialog: HTMLElement): boolean {
  return dialog.querySelector('[role="dialog"], [role="alertdialog"]') !== null
}
