import { useEffect, type RefObject } from 'react'

/**
 * 팝업(dialog) 안에서만 Tab 이 돈다 — 밖으로 새면 키보드로 뒤 화면을 누르게 된다 (디자인 2차 검토, DESIGN_PROMPT 3-1).
 * 열면 포커스를 팝업으로(또는 `initial`), 닫으면 연 자리로 돌려준다.
 * 차트 팝업에서 쓰던 것을 묶음 3 의 추가 시트도 쓰게 꺼냈다(검토 조건 3).
 */
export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  initial?: () => HTMLElement | null | undefined,
  /** 거짓이면 열 때 포커스를 옮기지 않는다 — 처음 칸을 스스로 고르는 팝업(종목 수정) */
  takeFocus = true,
) {
  useEffect(() => {
    const focusables = (root: HTMLElement) =>
      Array.from(
        root.querySelectorAll<HTMLElement>(
          'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter(
        (el) =>
          !el.closest('[hidden], [aria-hidden="true"]') &&
          // 닫힌 <details> 안은 summary 만 갈 수 있다 — 안의 단추가 "마지막 칸"으로 잡혀 summary 에서 Tab 이 밖으로 샜다(세 번째 재검토 참고 1)
          !(el.tagName !== 'SUMMARY' && el.closest('details:not([open])')),
      )
    const onTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !ref.current) return
      // 안쪽에 또 연 팝업(보유 탭의 수정·삭제 확인)이 있으면 맨 안쪽 팝업 안에서 돈다 — 그 팝업들에는 가두기가 없어
      // 그냥 손을 떼면 뒤 화면으로 샜다(재검토 조건 1)
      const inner = ref.current.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"]')
      const root = inner.length > 0 ? inner[inner.length - 1] : ref.current
      const items = focusables(root)
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement as HTMLElement | null
      // 포커스가 내 밖의 다른 팝업(예: 수정창 바깥에 그려지는 "닫을까요?") 안이면 그 팝업이 가둔다 — 둘이 Tab 마다
      // 서로 끌어와 한 단추에 묶였다(세 번째 재검토 조건 1)
      if (active && !ref.current.contains(active) && active.closest('[role="dialog"], [role="alertdialog"]')) return
      const inside = !!active && root.contains(active)
      if (e.shiftKey && (!inside || active === first)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (!inside || active === last)) {
        e.preventDefault()
        first.focus()
      }
    }
    const opener = document.activeElement as HTMLElement | null
    if (takeFocus) (initial?.() ?? ref.current)?.focus({ preventScroll: true })
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
