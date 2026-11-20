import { useEffect, useRef, type ReactNode } from 'react'
import { useBackToClose } from '../../lib/backToClose'
import { lockBodyScroll } from '../../lib/scrollLock'
import { isCovered, useFocusTrap } from '../../lib/focusTrap'

interface Props {
  /** 시트 제목 — 읽기 프로그램에도 이 이름으로 */
  title: ReactNode
  label: string
  sub?: ReactNode
  /** 닫기 ✕ 의 이름 ("목표 · 밴드 닫기") */
  closeLabel: string
  onClose: () => void
  /** 열 때 먼저 갈 칸 — 없으면 시트 안 첫 칸 */
  initialFocus?: () => HTMLElement | null | undefined
  className?: string
  children: ReactNode
}

/**
 * 바텀 시트 하나 (디자인 4차 — 종목 추가 시트와 같은 꼴). 폰은 아래에서, PC 는 가운데 팝업으로 뜬다(CSS).
 * 새 팝업에는 가두기를 꼭 단다(묶음 3 넘어온 것): Tab 은 안에서만 · Esc · 뒤로가기 · 뒤 화면 스크롤 잠금.
 * 보이기만 한다 — 값과 저장은 부르는 쪽이 들고 있다.
 */
export function Sheet({ title, label, sub, closeLabel, onClose, initialFocus, className = '', children }: Props) {
  useBackToClose(onClose)
  const ref = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  // 첫 칸을 주지 않으면 닫기 ✕ 로 — tabindex 없는 상자에 focus 를 부르면 포커스가 뒤 화면 줄에 남았다(묶음 4 검토 조건 4)
  useFocusTrap(ref, () => initialFocus?.() ?? closeRef.current)
  useEffect(() => {
    // 시트 안에 확인창(기록 삭제 등)이 떠 있으면 Esc 는 그쪽만 닫는다 — 한 번에 시트째 닫혔다(묶음 4 다섯 번째 검토 조건 1)
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (ref.current && isCovered(ref.current)) return
      onClose()
    }
    document.addEventListener('keydown', onKey)
    const release = lockBodyScroll()
    return () => {
      document.removeEventListener('keydown', onKey)
      release()
    }
  }, [onClose])

  return (
    <div className="modal-backdrop sheet-backdrop" onClick={onClose}>
      <div
        ref={ref}
        className={`sheet ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-grab" aria-hidden="true" />
        <div className="sheet-head">
          <div>
            <h3>{title}</h3>
            {sub && <p className="hint">{sub}</p>}
          </div>
          <button ref={closeRef} type="button" className="icon-btn" onClick={onClose} aria-label={closeLabel}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
