import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { ConfirmDialog } from './ConfirmDialog'
import { ErrorNotice } from './ErrorNotice'
import { whenLabel } from '../lib/display'
import type { AdminUser, UserStatus } from '../types'

/**
 * 관리자 — 사용자 목록과 가입 승인 (ROADMAP 4-4b).
 *
 * 누구나 구글로 신청할 수 있고, 여기서 승인해야 쓸 수 있다. 예전에는 `.env` 에 이메일을
 * 적고 서버를 다시 띄워야 했다.
 *
 * - 승인 대기 → **승인** / 거절
 * - 쓰는 중 → 차단 (확인을 한 번 더 받는다 — 그 사람이 바로 로그아웃된다)
 * - 거절·차단 → 다시 승인. 기록은 지우지 않았으므로 그대로 돌아온다
 */

const STATUS_META: Record<UserStatus, { label: string; badge: string }> = {
  pending: { label: '승인 대기', badge: 'badge-amber' },
  active: { label: '사용 중', badge: 'badge-green' },
  rejected: { label: '거절', badge: 'badge-grey' },
  blocked: { label: '차단', badge: 'badge-red' },
}

export function UsersModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [users, setUsers] = useState<AdminUser[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [confirmBlock, setConfirmBlock] = useState<AdminUser | null>(null)

  useEffect(() => {
    api.listUsers().then(setUsers).catch(setError)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !confirmBlock && onClose()
    document.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [onClose, confirmBlock])

  async function change(user: AdminUser, status: Exclude<UserStatus, 'pending'>) {
    setBusyId(user.id)
    setError(null)
    try {
      const updated = await api.setUserStatus(user.id, status)
      setUsers((rows) => rows?.map((row) => (row.id === updated.id ? updated : row)) ?? rows)
      onChanged()
    } catch (e) {
      setError(e)
    } finally {
      setBusyId(null)
      setConfirmBlock(null)
    }
  }

  const waiting = users?.filter((u) => u.status === 'pending').length ?? 0

  return (
    <>
      <div className="modal-backdrop" onClick={onClose}>
        <div
          className="modal users-modal"
          role="dialog"
          aria-modal="true"
          aria-label="사용자"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="modal-head">
            <div className="modal-title">
              <h3>사용자</h3>
              <span className="hint">
                {users === null
                  ? ''
                  : waiting > 0
                    ? `가입 신청 ${waiting}건이 기다리고 있습니다`
                    : `${users.length}명 · 기다리는 신청 없음`}
              </span>
            </div>
            <button className="icon-btn" onClick={onClose} aria-label="닫기">
              ✕
            </button>
          </div>

          <ErrorNotice error={error} onDismiss={() => setError(null)} />

          <p className="hint users-intro">
            구글로 처음 들어온 사람은 승인 대기로 시작합니다. 승인하면 바로(다시 로그인하지 않아도) 자기 종목과
            포트폴리오를 만들 수 있습니다. 거절·차단해도 기록은 지우지 않습니다.
          </p>

          <div className="users-list">
            {users === null && !error && <p className="hint">불러오는 중…</p>}
            {users?.map((user) => {
              const meta = STATUS_META[user.status] ?? STATUS_META.pending
              const busy = busyId === user.id
              return (
                <div className="user-row" key={user.id} data-testid={`user-${user.id}`}>
                  <div className="user-who">
                    <div className="user-name">
                      <b>{user.name || user.email || `사용자 ${user.id}`}</b>
                      <span className={`badge ${meta.badge}`}>{meta.label}</span>
                      {user.is_owner && <span className="badge badge-grey">관리자</span>}
                    </div>
                    {user.email && <span className="hint user-email">{user.email}</span>}
                    <span className="hint user-meta">
                      가입 {whenLabel(user.created_at)} · 마지막 접속 {whenLabel(user.last_login_at)} · 종목{' '}
                      {user.stock_count}개
                    </span>
                  </div>
                  {!user.is_owner && (
                    <div className="user-actions">
                      {user.status === 'pending' && (
                        <>
                          <button className="primary sm" disabled={busy} onClick={() => void change(user, 'active')}>
                            승인
                          </button>
                          <button className="ghost sm" disabled={busy} onClick={() => void change(user, 'rejected')}>
                            거절
                          </button>
                        </>
                      )}
                      {user.status === 'active' && (
                        <button className="ghost sm" disabled={busy} onClick={() => setConfirmBlock(user)}>
                          차단
                        </button>
                      )}
                      {(user.status === 'rejected' || user.status === 'blocked') && (
                        <button className="ghost sm" disabled={busy} onClick={() => void change(user, 'active')}>
                          {user.status === 'blocked' ? '차단 풀기' : '승인'}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* 목록 창 바깥에 둔다 — 안에 두면 확인 창 바깥을 누른 것이 목록 창까지 닫는다 */}
      {confirmBlock && (
        <ConfirmDialog
          title="차단할까요?"
          confirmLabel="차단"
          busyLabel="차단하는 중…"
          busy={busyId === confirmBlock.id}
          onConfirm={() => void change(confirmBlock, 'blocked')}
          onCancel={() => setConfirmBlock(null)}
        >
          <p>
            <b>{confirmBlock.name || confirmBlock.email}</b> 님은 바로 로그아웃되고, 다시 로그인해도 들어오지 못합니다.
          </p>
          <p className="hint">종목·보유수량 같은 기록은 남습니다. 차단을 풀면 그대로 돌아옵니다.</p>
        </ConfirmDialog>
      )}
    </>
  )
}
