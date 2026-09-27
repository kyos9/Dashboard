import { useBackToClose } from '../lib/backToClose'

/** 아이폰 설치 안내 — 폰의 뒤로가기로도 닫힌다. */
export function IosInstallHint({ onClose, onDismiss }: { onClose: () => void; onDismiss: () => void }) {
  useBackToClose(onClose)
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal install-hint"
        role="dialog"
        aria-modal="true"
        aria-label="홈 화면에 추가하는 방법"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div className="modal-title">
            <h3>홈 화면에 추가</h3>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </div>

        <div className="install-hint-body">
          <p>아이폰·아이패드는 사파리에서 직접 추가해야 합니다.</p>
          <ol>
            <li>
              아래쪽 <strong>공유</strong> 버튼을 누릅니다 (네모에서 화살표가 올라오는 모양).
            </li>
            <li>
              목록을 내려 <strong>홈 화면에 추가</strong>를 고릅니다.
            </li>
            <li>
              오른쪽 위 <strong>추가</strong>를 누릅니다.
            </li>
          </ol>
          <p className="hint-note">
            추가하고 나면 주소창 없이 앱처럼 열리고, 서버가 잠깐 안 잡혀도 마지막 화면이
            뜹니다.
          </p>
        </div>

        <div className="btn-group">
          <button onClick={onDismiss}>다시 보지 않기</button>
          <button className="primary" onClick={onClose}>
            알겠습니다
          </button>
        </div>
      </div>
    </div>
  )
}
