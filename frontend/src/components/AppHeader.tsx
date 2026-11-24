import { useEffect, useState, useSyncExternalStore } from 'react'
import { useAppState } from '../AppState'
import { useAuth } from './AuthGate'
import { Icon } from './icons/Icon'
import { GuestNotice, LoginButton } from './LoginPrompt'
import { pushAccount, syncPush } from '../lib/push'
import { lastLoadedAt, loadedAgoLabel, subscribeCache } from '../lib/cache'
import { useNarrow } from '../lib/narrow'
import { Link, useLocation } from 'react-router-dom'
import { api } from '../api/client'
import { diagnosticsReason } from '../lib/refreshText'
import { PC_TABS, activePcTab } from '../lib/tabs'

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
  const { user, guest, pending, isAdmin, mode, pendingCount, backupAttention, refreshAttention } = useAuth()
  const { pathname } = useLocation()
  // 들어와 쓰는 사람만 알림이 있다 (손님·승인 대기에게는 보낼 것이 없다)
  const member = !guest && !pending
  const account = pushAccount(user)

  // 켜 둔 기기가 서버와 맞는지 한 번 본다 — 서버 키가 바뀌었거나 구독이 빠졌으면 다시 채운다
  useEffect(() => {
    if (member) void syncPush(account)
  }, [member, account])

  // "3분 전 받음" — 화면이 서버에서 마지막으로 값을 받은 때 (ROADMAP 8-1). 30초마다 다시 센다.
  const loadedAt = useSyncExternalStore(subscribeCache, lastLoadedAt)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])
  const loadedAgo = loadedAgoLabel(loadedAt, Math.max(now, loadedAt ?? 0))

  // short — 아주 좁은 폰(340px 아래)에서 보이는 짧은 글. 좋은 상태는 점만 (디자인 4차 검토 — 긴 글이 접히거나 단추를 덮었다)
  const status = refreshing
    ? { dot: 'warn', text: '시세 갱신 중…', short: '갱신 중' }
    : refreshError
      ? { dot: 'bad', text: '갱신 실패', short: '실패' }
      : lastSync
        ? { dot: 'ok', text: '시세 연동 정상', short: '' }
        : { dot: 'ok', text: loadedAgo ?? '연결 확인 중', short: '' }

  const narrow = useNarrow()

  const statusPill = isAdmin && (
    <span
      className={`status-pill${narrow ? ' compact' : ''}`}
      title="이 화면이 서버에서 마지막으로 값을 받은 때입니다. 시세는 장 마감 뒤 서버가 매일 받고, 앱으로 돌아왔을 때 5분이 지났으면 다시 받습니다."
    >
      <span className={`status-dot ${status.dot}`} aria-hidden="true" />
      <span className="status-text">{status.text}</span>
      {narrow && status.short && (
        <span className="status-short" aria-hidden="true">
          {status.short}
        </span>
      )}
      {lastSync && !narrow && <span className="mono">갱신 {lastSync.toLocaleTimeString('ko-KR')}</span>}
    </span>
  )

  // 머리줄에는 상태 · 새로고침 · 로그인만 (디자인 4차 묶음 2). 나머지 단추와 ⋯ 메뉴는 설정 탭으로 갔다.
  // 관리자만 새로고침 — 전체 새로고침은 **전원의** 종목 시세를 다시 받는다. 사용자의 시세는 장 마감 뒤 서버가 받는다.
  const refreshButton = isAdmin && (
    <button
      onClick={() => void refreshAll()}
      disabled={refreshing}
      className={narrow ? 'primary icon-action' : 'header-refresh'}
      aria-label="전체 새로고침"
      title={refreshing ? '갱신 중…' : '전체 새로고침'}
    >
      <Icon name="refresh" size={20} className={refreshing ? 'spin' : undefined} />
      {!narrow && <span>{refreshing ? '갱신 중…' : '전체 새로고침'}</span>}
    </button>
  )

  // PC 새로고침 — 아이콘 하나(5차: 글씨와 아이콘을 같이 쓰지 않는다). 시세와 거래소 목록을 같이 받는다(주인 답 — "거래소 목록 갱신"을 여기로)
  const wideRefresh = isAdmin && (
    <button
      type="button"
      className="top-icon"
      onClick={() => void Promise.allSettled([refreshAll(), api.refreshSymbolListing()])}
      disabled={refreshing}
      aria-label="새로고침 (시세와 거래소 목록)"
      title={refreshing ? '갱신 중…' : '새로고침 (시세와 거래소 목록)'}
    >
      <Icon name="refresh" size={20} className={refreshing ? 'spin' : undefined} />
    </button>
  )

  // 관리자가 볼 것이 있으면 설정 톱니에 점 · 숫자 — 폰 아래 탭과 같은 규칙(TabBar)
  const diag = isAdmin ? diagnosticsReason(backupAttention, refreshAttention) : null
  const count = isAdmin ? pendingCount : 0
  // 주인: 숫자와 점이 같이 있으면 어지럽다 → 점 하나만. 무엇 때문인지는 읽기 이름 · 툴팁에 (설정 화면에 들어가면 자세히)
  const markReasons = [count > 0 ? `가입 신청 ${count}건` : null, diag ? `서버 상태를 확인하세요 (${diag})` : null].filter(Boolean)
  const settingsMark = markReasons.length > 0 && (
    <span className="tab-dot" role="img" aria-label={markReasons.join(', ')} title={markReasons.join(', ')} />
  )

  return (
    <>
      {narrow ? (
        // 폰: 로고 · 상태 · 새로고침 한 줄. 본문이 첫 화면에 보이게 (ROADMAP 8-2)
        <header className="app-header narrow">
          <div className="brand">
            {/* PC 왼쪽 메뉴의 로고와 같은 표 (사용자 확인: 폰 📈 · PC ₩ 로 갈렸다) */}
            <span className="brand-mark" aria-hidden="true">
              ₩
            </span>
            <h1 className="brand-title">자산관리</h1>
          </div>
          <div className="header-right">
            {statusPill}
            {refreshButton}
            {guest && !pending && <LoginButton label="로그인" />}
          </div>
        </header>
      ) : (
        // PC: 위 한 줄 — 로고 · 메뉴(홈 · 재무 · 리밸런싱 · 매크로) · 오른쪽 상태 · 새로고침 · 설정 · 계정 (디자인 5차 목업 01 다)
        <header className="app-header wide top-nav">
          <Link to="/" className="top-brand">
            <span className="top-logo" aria-hidden="true">
              ₩
            </span>
            <h1 className="top-brand-name">자산관리</h1>
          </Link>
          <nav className="top-menu" aria-label="화면">
            {PC_TABS.map((tab) => {
              const on = activePcTab(pathname) === tab.to
              return (
                <Link key={tab.to} to={tab.to} className={`top-tab${on ? ' active' : ''}`} aria-current={on ? 'page' : undefined}>
                  {tab.label}
                </Link>
              )
            })}
          </nav>
          <div className="header-right">
            {statusPill}
            {wideRefresh}
            {guest && !pending && <LoginButton label="로그인" />}
            <Link to="/settings" className={`top-icon${pathname.startsWith('/settings') ? ' active' : ''}`} aria-label="설정" title="설정">
              <Icon name="settings" size={20} />
              {settingsMark}
            </Link>
            {mode === 'google' && user && (
              <Link to="/settings" className="top-account" title={user.email ?? undefined}>
                <span className="top-avatar" aria-hidden="true">
                  {(user.name || user.email || '?').slice(0, 1)}
                </span>
                <span className="top-account-name">{user.name || user.email}</span>
              </Link>
            )}
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
    </>
  )
}
