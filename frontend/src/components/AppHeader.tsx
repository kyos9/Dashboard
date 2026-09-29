import { Suspense, useEffect, useState, useSyncExternalStore } from 'react'
import { useAppState } from '../AppState'
import { api } from '../api/client'
import { useAuth } from './AuthGate'
import { ConfirmDialog } from './ConfirmDialog'
import { HeaderMenu, type MenuItem } from './HeaderMenu'
import { TabBar } from './TabBar'
import { ModalLoading } from './ModalLoading'
import { GuestNotice, LoginButton } from './LoginPrompt'
import { pushAccount, syncPush } from '../lib/push'
import { lastLoadedAt, loadedAgoLabel, subscribeCache } from '../lib/cache'
import { useInstall } from '../lib/install'
import { useNarrow } from '../lib/narrow'
import { AiKeyModal, DiagnosticsModal, DisplayModal, PushModal, UsersModal } from '../lib/pageChunks'
import type { HealthInfo } from '../types'

/** 이미지를 만든 시각을 "9/21 16:11" 로. 읽을 수 없는 값이면 빈 문자열.
 *
 * **브라우저에서 바꾼다.** 서버에서 만들어 보내면 서버 시간대(UTC)로 찍히는데,
 * 보는 사람은 한국에 있다. 여기서 바꾸면 보는 사람의 시계와 같아진다.
 *
 * 잘못된 값이 오면 아무것도 안 붙인다 — `Invalid Date` 가 찍히는 건 없는 것보다 나쁘다.
 */
export function buildLabel(builtAt?: string | null): string {
  if (!builtAt) return ''
  const when = new Date(builtAt)
  if (Number.isNaN(when.getTime())) return ''
  // `toLocaleString` 에 맡기면 한국어 로케일에서 "9. 22. AM 01:11" 처럼 나온다.
  // 점과 AM/PM 이 섞여 한눈에 안 읽히므로 직접 조립한다. 날짜 부분은 브라우저의
  // 지역 시각(`getMonth`/`getHours`)을 쓰므로 보는 사람의 시계와 같다.
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${when.getMonth() + 1}/${when.getDate()} ${pad(when.getHours())}:${pad(when.getMinutes())}`
}

export function AppHeader() {
  const { refreshAll, refreshing, lastSync, refreshError } = useAppState()
  const { locked, mode, user, guest, pending, pendingCount, recountPending, isAdmin, logout, withdraw } = useAuth()
  const [showUsers, setShowUsers] = useState(false)
  const [confirmWithdraw, setConfirmWithdraw] = useState(false)
  const [withdrawing, setWithdrawing] = useState(false)
  const [withdrawError, setWithdrawError] = useState<string | null>(null)

  async function doWithdraw() {
    setWithdrawing(true)
    setWithdrawError(null)
    try {
      await withdraw()
    } catch (e) {
      setWithdrawError(e instanceof Error ? e.message : String(e))
      setWithdrawing(false)
    }
  }
  const [health, setHealth] = useState<HealthInfo | null>(null)
  const [showDiagnostics, setShowDiagnostics] = useState(false)
  const [showPush, setShowPush] = useState(false)
  const [showAi, setShowAi] = useState(false)
  const [showDisplay, setShowDisplay] = useState(false)
  // 들어와 쓰는 사람만 알림이 있다 (손님·승인 대기에게는 보낼 것이 없다)
  const member = !guest && !pending
  const account = pushAccount(user)

  // 켜 둔 기기가 서버와 맞는지 한 번 본다 — 서버 키가 바뀌었거나 구독이 빠졌으면 다시 채운다
  useEffect(() => {
    if (member) void syncPush(account)
  }, [member, account])

  // 실행 중인 백엔드 버전을 헤더에 띄운다 — 업데이트 후 서버를 다시 켰는지 한눈에 확인하려고.
  useEffect(() => {
    api
      .getHealth()
      .then(setHealth)
      .catch(() => setHealth(null))
  }, [])

  // "3분 전 받음" — 화면이 서버에서 마지막으로 값을 받은 때 (ROADMAP 8-1). 30초마다 다시 센다.
  const loadedAt = useSyncExternalStore(subscribeCache, lastLoadedAt)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])
  const loadedAgo = loadedAgoLabel(loadedAt, Math.max(now, loadedAt ?? 0))

  const status = refreshing
    ? { dot: 'warn', text: '시세 갱신 중…' }
    : refreshError
      ? { dot: 'bad', text: '갱신 실패' }
      : lastSync
        ? { dot: 'ok', text: '시세 연동 정상' }
        : { dot: 'ok', text: loadedAgo ?? '연결 확인 중' }

  const narrow = useNarrow()
  const install = useInstall()
  const signedIn = mode === 'google' && user
  const canLogout = locked && (!guest || pending)
  // 관리자는 탈퇴할 수 없다 (공용 데이터를 돌볼 사람이 사라진다)
  const canWithdraw = mode === 'google' && user && !user.is_owner && !pending
  const version = health?.version
    ? `v${health.version}${buildLabel(health.built_at) ? ` · ${buildLabel(health.built_at)}` : ''}`
    : null
  const versionTitle =
    [
      health?.revision ? `커밋 ${health.revision}` : null,
      health?.providers_by_market
        ? `시세 제공자 — 해외: ${health.providers_by_market.US.join(' → ')}` +
          ` / 국내: ${health.providers_by_market.KR.join(' → ')}`
        : null,
    ]
      .filter(Boolean)
      .join('\n') || undefined

  // ⋯ 메뉴 (ROADMAP 8-2). 관리자 도구(진단·사용자)는 PC·폰 모두 여기에 있고, 폰에서는 나머지 버튼도
  // 들어온다 — 헤더를 한 줄로 만들려고.
  //
  // 관리자만의 것: 진단에는 남의 종목과 오류가 찍혀 있다. 계정이 있는 것은 구글 로그인뿐이다
  // (혼자 쓰는 서버에는 사용자 목록이 없다).
  const adminItems: MenuItem[] = isAdmin
    ? [
        { key: 'diag', label: '진단', title: '서버가 남긴 경고·오류 보기', onSelect: () => setShowDiagnostics(true) },
        ...(mode === 'google'
          ? [
              {
                key: 'users',
                label: (
                  <>
                    사용자
                    {pendingCount > 0 && (
                      <span className="badge badge-amber count-badge" aria-label={`가입 신청 ${pendingCount}건`}>
                        {pendingCount}
                      </span>
                    )}
                  </>
                ),
                title: pendingCount > 0 ? `가입 신청 ${pendingCount}건이 기다리고 있습니다` : '사용자 목록',
                onSelect: () => setShowUsers(true),
              },
            ]
          : []),
      ]
    : []
  const phoneItems: MenuItem[] = [
    ...(member ? [{ key: 'push', label: '알림 설정', onSelect: () => setShowPush(true) }] : []),
    ...(member ? [{ key: 'ai', label: 'AI 키 설정', onSelect: () => setShowAi(true) }] : []),
    ...(install.available ? [{ key: 'install', label: '앱 설치', onSelect: install.start }] : []),
    { key: 'display', label: '화면 설정', title: '테마 · 상승 색', onSelect: () => setShowDisplay(true) },
    ...adminItems,
    ...(canLogout ? [{ key: 'logout', label: '나가기', onSelect: () => void logout() }] : []),
    ...(canWithdraw
      ? [{ key: 'withdraw', label: '탈퇴', danger: true, onSelect: () => setConfirmWithdraw(true) }]
      : []),
  ]
  const accountHead = signedIn ? (
    <div className="menu-account">
      <span className="account-name">{user.name || user.email}</span>
      {user.name && user.email && <span className="menu-email">{user.email}</span>}
      {(user.is_owner || pending) && (
        <span className="menu-account-badges">
          {user.is_owner && <span className="badge badge-grey">관리자</span>}
          {pending && <span className="badge badge-amber">승인 대기</span>}
        </span>
      )}
    </div>
  ) : null

  const statusPill = isAdmin && (
    <span
      className={`status-pill${narrow ? ' compact' : ''}`}
      title="이 화면이 서버에서 마지막으로 값을 받은 때입니다. 시세는 장 마감 뒤 서버가 매일 받고, 앱으로 돌아왔을 때 5분이 지났으면 다시 받습니다."
    >
      <span className={`status-dot ${status.dot}`} aria-hidden="true" />
      {status.text}
      {lastSync && !narrow && <span className="mono">갱신 {lastSync.toLocaleTimeString('ko-KR')}</span>}
    </span>
  )

  return (
    <>
      {narrow ? (
        // 폰: 로고 · 상태 · 새로고침 · 메뉴 한 줄. 본문이 첫 화면에 보이게 (ROADMAP 8-2)
        <header className="app-header narrow">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">
              📈
            </span>
            <h1 className="brand-title">자산관리</h1>
          </div>
          <div className="header-right">
            {statusPill}
            {isAdmin && (
              <button
                onClick={() => void refreshAll()}
                disabled={refreshing}
                className="primary icon-action"
                aria-label="전체 새로고침"
                title={refreshing ? '갱신 중…' : '전체 새로고침'}
              >
                <svg
                  className={refreshing ? 'spin' : undefined}
                  viewBox="0 0 24 24"
                  width="20"
                  height="20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M20 12a8 8 0 1 1-2.34-5.66" />
                  <path d="M20 4v4.5h-4.5" />
                </svg>
              </button>
            )}
            {guest && !pending && <LoginButton label="로그인" />}
            <HeaderMenu
              items={phoneItems}
              head={accountHead}
              badge={isAdmin ? pendingCount : 0}
              foot={
                version && (
                  <span className="mono" title={versionTitle}>
                    {version}
                  </span>
                )
              }
            />
          </div>
        </header>
      ) : (
        <header className="app-header">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">
              📈
            </span>
            <div className="brand-text">
              <h1 className="brand-title">
                자산관리
                <span className="badge badge-blue">내 포트폴리오</span>
                {version && (
                  <span className="badge badge-grey mono" title={versionTitle}>
                    {version}
                  </span>
                )}
              </h1>
              <p className="brand-sub">평가금액·수익률 · 리밸런싱 가이드 · 매수·매도 시그널(참고)</p>
            </div>
          </div>

          <div className="header-right">
            {/* 관리자만. 전체 새로고침은 **전원의** 종목 시세를 다시 받는다. 사용자의 시세는 장 마감 뒤
                서버가 알아서 받는다. */}
            {statusPill}
            {isAdmin && (
              <button onClick={() => void refreshAll()} disabled={refreshing} className="primary">
                {refreshing ? '갱신 중…' : '전체 새로고침'}
              </button>
            )}
            {guest && !pending && <LoginButton label="로그인" />}
            {member && (
              <button className="ghost" onClick={() => setShowPush(true)} title="알림 설정" aria-label="알림 설정">
                🔔
              </button>
            )}
            {member && (
              <button className="ghost" onClick={() => setShowAi(true)} title="AI 키 설정" aria-label="AI 키 설정">
                AI
              </button>
            )}
            {/* 설치할 수 있을 때만 나온다 (이미 설치했거나 PC 크롬이 아니면 숨는다) */}
            {install.available && (
              <button className="ghost" onClick={install.start} title="홈 화면에 앱으로 추가합니다">
                앱 설치
              </button>
            )}
            {/* 누구로 들어와 있는지 — 계정이 여럿인 폰에서 "내 종목이 없어졌다"가 사실은
                다른 계정으로 들어온 것일 때가 있다. 그걸 한눈에 가릴 수 있어야 한다. */}
            {signedIn && (
              <span className="account-chip" title={user.email ?? undefined}>
                <span className="account-name">{user.name || user.email}</span>
                {user.is_owner && <span className="badge badge-grey">관리자</span>}
                {pending && <span className="badge badge-amber">승인 대기</span>}
              </span>
            )}
            {/* 잠긴 서버에서 들어와 있을 때만 — 개인 PC와 손님에게는 나갈 문이 없다.
                승인을 기다리는 사람은 나갈 수 있다 (다른 계정으로 바꿔 들어오려고) */}
            {canLogout && (
              <button className="ghost" onClick={() => void logout()} title="로그아웃">
                나가기
              </button>
            )}
            {canWithdraw && (
              <button className="ghost" onClick={() => setConfirmWithdraw(true)}>
                탈퇴
              </button>
            )}
            <button className="ghost" onClick={() => setShowDisplay(true)} title="테마 · 상승 색">
              화면
            </button>
            {/* 관리자 도구는 메뉴로 — 헤더 버튼이 아홉 개였다 */}
            {adminItems.length > 0 && <HeaderMenu items={adminItems} badge={pendingCount} />}
          </div>
        </header>
      )}

      {refreshError && (
        <div className="header-alert">
          <span aria-hidden="true">⚠</span>
          <span>{refreshError}</span>
        </div>
      )}

      <GuestNotice />

      <TabBar />

      {/* 팝업 코드는 누를 때 받는다(8-5) — 받는 동안 제목과 닫기 버튼이 있는 틀을 먼저 띄운다 */}
      {showDiagnostics && (
        <Suspense fallback={<ModalLoading plain title="진단" onClose={() => setShowDiagnostics(false)} />}>
          <DiagnosticsModal onClose={() => setShowDiagnostics(false)} />
        </Suspense>
      )}
      {showPush && (
        <Suspense fallback={<ModalLoading plain title="알림" onClose={() => setShowPush(false)} />}>
          <PushModal account={account} onClose={() => setShowPush(false)} />
        </Suspense>
      )}
      {showAi && (
        <Suspense fallback={<ModalLoading plain title="AI 키" onClose={() => setShowAi(false)} />}>
          <AiKeyModal account={account} onClose={() => setShowAi(false)} />
        </Suspense>
      )}
      {showDisplay && (
        <Suspense fallback={<ModalLoading plain title="화면 설정" onClose={() => setShowDisplay(false)} />}>
          <DisplayModal onClose={() => setShowDisplay(false)} />
        </Suspense>
      )}
      {install.hint}
      {showUsers && (
        <Suspense fallback={<ModalLoading plain title="사용자" onClose={() => setShowUsers(false)} />}>
          <UsersModal onClose={() => setShowUsers(false)} onChanged={recountPending} />
        </Suspense>
      )}

      {confirmWithdraw && (
        <ConfirmDialog
          title="탈퇴할까요?"
          confirmLabel="탈퇴"
          busyLabel="지우는 중…"
          busy={withdrawing}
          onConfirm={() => void doWithdraw()}
          onCancel={() => {
            setConfirmWithdraw(false)
            setWithdrawError(null)
          }}
        >
          <p>
            내 종목 목록·보유수량·매수 기록·설정이 전부 지워집니다. <strong>되돌릴 수 없습니다.</strong>
          </p>
          <p className="hint">
            다시 들어오면 빈 화면에서 새로 시작합니다. 시세·매크로 같은 공용 데이터는 남고, 거기에는 나를 가리키는 것이
            없습니다.
          </p>
          {withdrawError && <p className="error-text">{withdrawError}</p>}
        </ConfirmDialog>
      )}
    </>
  )
}
