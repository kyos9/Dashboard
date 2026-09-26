import { useEffect } from 'react'
import { useBackToClose } from '../lib/backToClose'
import { AiKeyForm } from './AiKeyForm'

/**
 * 헤더의 "AI" — 내 AI 키 넣기·바꾸기·지우기 (ROADMAP 3c).
 *
 * 분석은 대시보드 맨 오른쪽 버튼·종목 팝업의 "AI 분석" 탭에서 받는다. 여기는 키만 다룬다.
 */
export function AiKeyModal({ account, onClose }: { account: string; onClose: () => void }) {
  // 폰의 뒤로가기로도 닫힌다
  useBackToClose(onClose)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [onClose])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal ai-key-modal"
        role="dialog"
        aria-modal="true"
        aria-label="AI 키 설정"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div className="modal-title">
            <h3>AI 키</h3>
            <span className="hint">대시보드·종목 팝업의 "AI 분석"에 씁니다</span>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </div>
        <AiKeyForm account={account} />
      </div>
    </div>
  )
}
