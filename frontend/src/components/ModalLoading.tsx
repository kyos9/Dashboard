import { useEffect } from 'react'

/**
 * 팝업 조각을 받는 동안 먼저 띄우는 틀 (ROADMAP 8-1).
 *
 * 누르자마자 팝업이 열린다 — 제목과 닫기 버튼이 먼저 보이고, 안쪽만 나중에 채워진다.
 * 전에는 조각을 다 받을 때까지 아무것도 안 떠서, 한 번 더 누르게 됐다.
 */
export function ModalLoading({ title, subtitle, onClose }: { title: string; subtitle?: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal chart-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-busy="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div className="modal-title">
            <h3>{title}</h3>
            {subtitle && <span className="hint">{subtitle}</span>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </div>
        <div className="skeleton skeleton-chart" aria-hidden="true" />
        <p className="hint">여는 중…</p>
      </div>
    </div>
  )
}
