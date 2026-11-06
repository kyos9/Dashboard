import { useEffect } from 'react'
import { useBackToClose } from '../lib/backToClose'
import { AiPanel } from './AiPanel'
import { TITLES } from '../lib/aiTitles'
import { lockBodyScroll } from '../lib/scrollLock'


/**
 * 종목 하나가 아닌 AI 정리를 띄우는 창 (ROADMAP 3c-2) — 대시보드의 "AI 전체 정리", 매크로의 "AI 정리",
 * 포트폴리오 보기의 "AI 포트폴리오 진단"(9-7 — 관리자가 사용자에게 열고 닫는다, 9-15).
 * 창을 닫으면 받던 글도 멈춘다 (`AiPanel`).
 */
export function AiSummaryModal({
  kind,
  account,
  onClose,
}: {
  kind: 'watchlist' | 'macro' | 'portfolio'
  account: string
  onClose: () => void
}) {
  // 폰의 뒤로가기로도 닫힌다
  useBackToClose(onClose)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    const release = lockBodyScroll()
    return () => {
      document.removeEventListener('keydown', onKey)
      release()
    }
  }, [onClose])

  const { title, sub } = TITLES[kind]
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal ai-summary-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div className="modal-title">
            <h3>{title}</h3>
            <span className="hint">{sub}</span>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </div>
        <AiPanel target={{ kind }} account={account} />
      </div>
    </div>
  )
}
