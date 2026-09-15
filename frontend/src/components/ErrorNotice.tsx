import { ApiError } from '../api/client'

/**
 * 오류 표시 — 사용자가 할 일(hint)을 앞세우고, 기술적 원인은 접어둔다.
 *
 * 시세 수집 실패는 원인 문자열이 길다(제공자별 예외가 그대로 담긴다). 그대로 쏟아내면
 * 정작 무엇을 해야 하는지가 묻히므로, 안내를 먼저 보여주고 상세는 펼쳐볼 수 있게 한다.
 */
export function ErrorNotice({ error, onDismiss }: { error: unknown; onDismiss?: () => void }) {
  if (!error) return null

  const isApi = error instanceof ApiError
  const headline = isApi ? (error.hint ?? error.detail) : String(error)
  const detail = isApi && error.hint ? error.detail : null

  return (
    <div className="error-text">
      <div className="error-head">
        <span aria-hidden="true">⚠</span>
        <span>{headline}</span>
        {onDismiss && (
          <button className="ghost sm error-dismiss" onClick={onDismiss} aria-label="오류 메시지 닫기">
            닫기
          </button>
        )}
      </div>
      {detail && (
        <details className="error-detail">
          <summary>기술적 원인 보기</summary>
          <p>{detail}</p>
        </details>
      )}
    </div>
  )
}
