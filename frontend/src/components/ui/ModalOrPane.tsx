import { useEffect, type ReactNode } from 'react'
import { useBackToClose } from '../../lib/backToClose'
import { lockBodyScroll } from '../../lib/scrollLock'

interface Props {
  /** PC 설정 오른쪽 칸 안에 그린다 (디자인 5차 목업 08 가) — 뒤 화면 · 닫기 ✕ · Esc · 뒤로가기 없음 */
  inline?: boolean
  /** 읽기 프로그램이 부르는 이름 */
  label: string
  /** .modal 옆에 붙는 이름 (display-modal 등) */
  className: string
  title: ReactNode
  sub?: ReactNode
  /** 제목 줄 오른쪽 (서버 상태의 "경고·오류만 / 전체") */
  headExtra?: ReactNode
  onClose: () => void
  /** 안에 확인창이 떠 있으면 Esc 를 그쪽에 맡긴다 */
  escBlocked?: boolean
  children: ReactNode
}

function Modal({ label, className, title, sub, headExtra, onClose, escBlocked = false, children }: Props) {
  // 폰의 뒤로가기로도 닫힌다
  useBackToClose(onClose)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !escBlocked && onClose()
    document.addEventListener('keydown', onKey)
    const release = lockBodyScroll()
    return () => {
      document.removeEventListener('keydown', onKey)
      release()
    }
  }, [onClose, escBlocked])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className={`modal ${className}`} role="dialog" aria-modal="true" aria-label={label} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-title">
            <h3>{title}</h3>
            {sub}
          </div>
          {headExtra}
          <button className="icon-btn" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

function Pane({ label, className, title, sub, headExtra, children }: Props) {
  return (
    <section className={`settings-pane ${className}`} aria-label={label}>
      <div className="modal-head settings-pane-head">
        <div className="modal-title">
          <h3>{title}</h3>
          {sub}
        </div>
        {headExtra}
      </div>
      {children}
    </section>
  )
}

/** 설정 창 다섯의 겉틀 — 폰은 창(지금 그대로), PC 설정은 오른쪽 칸 안 */
export function ModalOrPane(props: Props) {
  return props.inline ? <Pane {...props} /> : <Modal {...props} />
}
