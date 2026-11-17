import { useEffect, useRef, type ReactNode } from 'react'
import { useBackToClose } from '../../lib/backToClose'
import { lockBodyScroll } from '../../lib/scrollLock'
import { useFocusTrap } from '../../lib/focusTrap'

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
  useFocusTrap(ref, initialFocus)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
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
          <button type="button" className="icon-btn" onClick={onClose} aria-label={closeLabel}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
