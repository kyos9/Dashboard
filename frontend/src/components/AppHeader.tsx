import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { useAppState } from '../AppState'
import { api } from '../api/client'
import { useAuth } from './AuthGate'
import { ConfirmDialog } from './ConfirmDialog'
import { DiagnosticsModal } from './DiagnosticsModal'
import { InstallButton } from './InstallButton'
import { UsersModal } from './UsersModal'
import { GuestNotice, LoginButton } from './LoginPrompt'
import type { HealthInfo } from '../types'

type Theme = 'dark' | 'light'

const THEME_KEY = 'signalboard.theme'

function readStoredTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    // 브라우저가 저장소를 막아둔 경우 기본값으로 진행
  }
  return 'dark'
}

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

const TABS = [
  { to: '/', label: '대시보드', end: true },
  { to: '/history', label: '히스토리 차트', end: false },
  { to: '/macro', label: '매크로', end: false },
  { to: '/rebalance', label: '리밸런싱', end: false },
  { to: '/stocks', label: '종목 관리', end: false },
]

export function AppHeader() {
  const { refreshAll, refreshing, lastSync, refreshError } = useAppState()
  const { locked, mode, user, guest, pending, pendingCount, recountPending, isAdmin, logout, withdraw } =
    useAuth()
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
  const [theme, setTheme] = useState<Theme>(readStoredTheme)
  const [health, setHealth] = useState<HealthInfo | null>(null)
  const [showDiagnostics, setShowDiagnostics] = useState(false)

  // 실행 중인 백엔드 버전을 헤더에 띄운다 — 업데이트 후 서버를 다시 켰는지 한눈에 확인하려고.
  useEffect(() => {
    api.getHealth().then(setHealth).catch(() => setHealth(null))
  }, [])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)

    // 폰에 설치해 열면 주소창·상태바가 이 색으로 칠해진다. 테마를 바꿨는데 위쪽만
    // 어두운 채로 남으면 앱이 덜 그려진 것처럼 보인다. index.css의 --bg를 그대로
    // 읽어 쓴다 — 색을 여기에 또 적으면 언젠가 둘이 어긋난다.
    const meta = document.querySelector('meta[name="theme-color"]')
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
    if (meta && bg) meta.setAttribute('content', bg)

    try {
      localStorage.setItem(THEME_KEY, theme)
    } catch {
      // 저장 실패는 무시 — 이번 세션에만 적용된다
    }
  }, [theme])

  const status = refreshing
    ? { dot: 'warn', text: '시세 갱신 중…' }
    : refreshError
      ? { dot: 'bad', text: '갱신 실패' }
      : lastSync
        ? { dot: 'ok', text: '시세 연동 정상' }
        : { dot: 'ok', text: '저장된 데이터 표시 중' }

  return (
    <>
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            📈
          </span>
          <div className="brand-text">
            <h1 className="brand-title">
              신호판
              <span className="badge badge-blue">매수·매도 시그널</span>
              {health?.version && (
                <span
                  className="badge badge-grey mono"
                  title={[
                    health.revision ? `커밋 ${health.revision}` : null,
                    health.providers_by_market
                      ? `시세 제공자 — 해외: ${health.providers_by_market.US.join(' → ')}` +
                        ` / 국내: ${health.providers_by_market.KR.join(' → ')}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join('\n') || undefined}
                >
                  v{health.version}
                  {buildLabel(health.built_at) && ` · ${buildLabel(health.built_at)}`}
                </span>
              )}
            </h1>
            <p className="brand-sub">기술적 타이밍 시그널 · 리밸런싱 가이드 · 비중조절 신호</p>
          </div>
        </div>

        <div className="header-right">
          {/* 관리자만. 전체 새로고침은 **전원의** 종목 시세를 다시 받고, 진단에는 남의 종목과
              오류가 찍혀 있다. 사용자의 시세는 장 마감 뒤 서버가 알아서 받는다. */}
          {isAdmin && (
            <>
              <span className="status-pill">
                <span className={`status-dot ${status.dot}`} aria-hidden="true" />
                {status.text}
                {lastSync && (
                  <span className="mono">갱신 {lastSync.toLocaleTimeString('ko-KR')}</span>
                )}
              </span>
              <button onClick={() => void refreshAll()} disabled={refreshing} className="primary">
                {refreshing ? '갱신 중…' : '전체 새로고침'}
              </button>
              <button
                className="ghost"
                onClick={() => setShowDiagnostics(true)}
                title="서버가 남긴 경고·오류 보기"
              >
                진단
              </button>
              {/* 계정이 있는 것은 구글 로그인뿐이다 — 혼자 쓰는 서버에는 사용자 목록이 없다 */}
              {mode === 'google' && (
                <button
                  className="ghost"
                  onClick={() => setShowUsers(true)}
                  title={pendingCount > 0 ? `가입 신청 ${pendingCount}건이 기다리고 있습니다` : '사용자 목록'}
                >
                  사용자
                  {pendingCount > 0 && (
                    <span className="badge badge-amber count-badge" aria-label={`가입 신청 ${pendingCount}건`}>
                      {pendingCount}
                    </span>
                  )}
                </button>
              )}
            </>
          )}
          {guest && !pending && <LoginButton label="로그인" />}
          {/* 설치할 수 있을 때만 나온다 (이미 설치했거나 PC 크롬이 아니면 숨는다) */}
          <InstallButton />
          {/* 누구로 들어와 있는지 — 계정이 여럿인 폰에서 "내 종목이 없어졌다"가 사실은
              다른 계정으로 들어온 것일 때가 있다. 그걸 한눈에 가릴 수 있어야 한다. */}
          {mode === 'google' && user && (
            <span className="account-chip" title={user.email ?? undefined}>
              <span className="account-name">{user.name || user.email}</span>
              {user.is_owner && <span className="badge badge-grey">관리자</span>}
              {pending && <span className="badge badge-amber">승인 대기</span>}
            </span>
          )}
          {/* 잠긴 서버에서 들어와 있을 때만 — 개인 PC와 손님에게는 나갈 문이 없다.
              승인을 기다리는 사람은 나갈 수 있다 (다른 계정으로 바꿔 들어오려고) */}
          {locked && (!guest || pending) && (
            <button className="ghost" onClick={() => void logout()} title="로그아웃">
              나가기
            </button>
          )}
          {/* 관리자는 탈퇴할 수 없다 (공용 데이터를 돌볼 사람이 사라진다) */}
          {mode === 'google' && user && !user.is_owner && !pending && (
            <button className="ghost" onClick={() => setConfirmWithdraw(true)}>
              탈퇴
            </button>
          )}
          <button
            className="ghost"
            onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
            aria-label={theme === 'dark' ? '밝은 테마로 전환' : '어두운 테마로 전환'}
            title={theme === 'dark' ? '밝은 테마로 전환' : '어두운 테마로 전환'}
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
        </div>
      </header>

      {refreshError && (
        <div className="header-alert">
          <span aria-hidden="true">⚠</span>
          <span>{refreshError}</span>
        </div>
      )}

      <GuestNotice />

      <nav className="tabs">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) => `tab${isActive ? ' active' : ''}`}
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>

      {showDiagnostics && <DiagnosticsModal onClose={() => setShowDiagnostics(false)} />}
      {showUsers && <UsersModal onClose={() => setShowUsers(false)} onChanged={recountPending} />}

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
            다시 들어오면 빈 화면에서 새로 시작합니다. 시세·매크로 같은 공용 데이터는 남고,
            거기에는 나를 가리키는 것이 없습니다.
          </p>
          {withdrawError && <p className="error-text">{withdrawError}</p>}
        </ConfirmDialog>
      )}
    </>
  )
}
