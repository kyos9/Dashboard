import { useEffect, useRef } from 'react'
import { useBackToClose } from '../lib/backToClose'

interface Props {
  title: string
  confirmLabel: string
  busyLabel?: string
  busy?: boolean
  children: React.ReactNode
  onConfirm: () => void
  onCancel: () => void
}

/**
 * 되돌릴 수 없는 동작을 한 번 더 묻는다.
 *
 * 확인 문구를 표 아래에 붙이면, 종목이 많아 화면 밖으로 밀려났을 때 "삭제를 눌렀는데
 * 아무 일도 안 일어난다"가 된다. 그래서 화면 한가운데에 띄우고 뒤를 가린다 — 지금
 * 대답해야 할 것이 하나뿐임이 눈에 보여야 한다.
 *
 * 처음 focus는 "취소"에 준다. 되돌릴 수 없는 쪽에 두면 Enter 한 번에 지워진다.
 */
export function ConfirmDialog({
  title,
  confirmLabel,
  busyLabel,
  busy = false,
  children,
  onConfirm,
  onCancel,
}: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    cancelRef.current?.focus()
  }, [])

  // 폰의 뒤로가기로도 닫힌다 (지우는 중에는 안 닫힌다)
  useBackToClose(onCancel, !busy)

  // ESC로 닫기 + 뒤 화면이 같이 스크롤되지 않게 (차트 팝업과 같은 규칙)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel()
    }
    document.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [busy, onCancel])

  return (
    <div className="modal-backdrop" onClick={() => !busy && onCancel()}>
      <div
        className="modal confirm-modal"
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div className="modal-title">
            <h3>{title}</h3>
          </div>
        </div>

        <div className="confirm-body">{children}</div>

        <div className="btn-group confirm-actions">
          <button ref={cancelRef} disabled={busy} onClick={onCancel}>
            취소
          </button>
          <button className="danger" disabled={busy} onClick={onConfirm}>
            {busy ? (busyLabel ?? '처리 중…') : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
