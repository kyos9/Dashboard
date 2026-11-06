import { Suspense, useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, api } from '../api/client'
import { useAuth } from '../components/AuthGate'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Icon } from '../components/icons/Icon'
import { LoginButton } from '../components/LoginPrompt'
import { ModalLoading } from '../components/ModalLoading'
import { buildLabel } from '../components/AppHeader'
import { useInstall } from '../lib/install'
import { AiKeyModal, DiagnosticsModal, DisplayModal, PushModal, UsersModal } from '../lib/pageChunks'
import { POLICY_PATH } from '../lib/policy'
import { diagnosticsReason } from '../lib/refreshText'
import { pushAccount } from '../lib/push'
import { usePrefs } from '../lib/prefs'
import type { HealthInfo } from '../types'
import tfScreen from '../assets/tossface/u1F5A5.svg'
import tfBell from '../assets/tossface/u1F514.svg'
import tfKey from '../assets/tossface/u1F511.svg'
import tfDiag from '../assets/tossface/u1FA7A.svg'
import tfUsers from '../assets/tossface/u1F465.svg'
import tfDoor from '../assets/tossface/u1F6AA.svg'
import tfDoc from '../assets/tossface/u1F4C4.svg'
import tfScroll from '../assets/tossface/u1F4DC.svg'
import tfInstall from '../assets/tossface/u1F4F2.svg'

/** 설정의 한 줄 — 토스페이스 그림 · 이름 · 지금 값 · › (디자인 4차 목업 09) */
function Row({
  face,
  label,
  value,
  badge,
  danger,
  onClick,
  to,
  href,
  title,
}: {
  face?: string
  label: ReactNode
  value?: ReactNode
  badge?: ReactNode
  danger?: boolean
  onClick?: () => void
  to?: string
  href?: string
  title?: string
}) {
  const body = (
    <>
      {face ? <img className="settings-face" src={face} alt="" width={24} height={24} /> : <span className="settings-face" />}
      <span className="settings-label">
        {label}
        {badge}
      </span>
      {value != null && <span className="settings-value">{value}</span>}
      <Icon name="forward" size={18} className="settings-go" />
    </>
  )
  const cls = `settings-row${danger ? ' danger' : ''}`
  if (to) return <Link className={cls} to={to} title={title}>{body}</Link>
  if (href)
    return (
      <a className={cls} href={href} target="_blank" rel="noreferrer" title={title}>
        {body}
      </a>
    )
  return (
    <button type="button" className={cls} onClick={onClick} title={title}>
      {body}
    </button>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="settings-group" aria-label={title}>
      <h3 className="settings-group-title">{title}</h3>
      <div className="settings-list">{children}</div>
    </section>
  )
}

/**
 * 설정 탭 (디자인 4차 묶음 2 — 주인: 탭 구성 B). 예전 머리줄 ⋯ 메뉴와 PC 머리줄 단추들이 여기로 왔다.
 * 숨은 메뉴가 없다 — 무엇이 있는지 한 화면에 다 보인다.
 */
export function SettingsPage() {
  const {
    locked, mode, user, guest, pending, pendingCount, backupAttention, refreshAttention, recountPending, isAdmin, logout, withdraw,
    logoutEverywhere,
  } = useAuth()
  const install = useInstall()
  const member = !guest && !pending
  const account = pushAccount(user)

  const [showUsers, setShowUsers] = useState(false)
  const [showDiagnostics, setShowDiagnostics] = useState(false)
  const [showPush, setShowPush] = useState(false)
  const [showAi, setShowAi] = useState(false)
  const [showDisplay, setShowDisplay] = useState(false)
  const [confirmWithdraw, setConfirmWithdraw] = useState(false)
  const [withdrawing, setWithdrawing] = useState(false)
  const [withdrawError, setWithdrawError] = useState<string | null>(null)
  const [confirmEverywhere, setConfirmEverywhere] = useState(false)
  const [leavingEverywhere, setLeavingEverywhere] = useState(false)
  const [everywhereError, setEverywhereError] = useState<string | null>(null)
  const [health, setHealth] = useState<HealthInfo | null>(null)
  const prefs = usePrefs()

  useEffect(() => {
    api
      .getHealth()
      .then(setHealth)
      .catch(() => setHealth(null))
  }, [])

  async function doLogoutEverywhere() {
    setLeavingEverywhere(true)
    setEverywhereError(null)
    try {
      await logoutEverywhere()
    } catch (e) {
      // 화면이 서버보다 새로우면(업데이트 중) 서버가 이 기능을 모른다 — 405/404 를 영어 그대로 보이지 않는다
      const unknown = e instanceof ApiError && (e.status === 404 || e.status === 405)
      setEverywhereError(
        unknown
          ? '서버가 아직 이 기능을 모릅니다 — 서버 업데이트가 끝난 뒤 다시 눌러 주세요. 이 기기에서만 나가려면 "나가기"를 누르세요.'
          : e instanceof Error
            ? e.message
            : String(e),
      )
      setLeavingEverywhere(false)
    }
  }

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

  const signedIn = mode === 'google' && user
  const canLogout = locked && (!guest || pending)
  // 관리자는 탈퇴할 수 없다 (공용 데이터를 돌볼 사람이 사라진다)
  const canWithdraw = mode === 'google' && user && !user.is_owner && !pending
  // 모든 기기에서 나가기 (0.45.4) — 구글 로그인으로 들어와 쓰는 사람만. 승인 대기는 서버가 401 이다
  const canLogoutAll = mode === 'google' && !!user && !pending && !guest
  const diagReason = diagnosticsReason(backupAttention, refreshAttention)
  const diagDot = diagReason ? `진단을 확인하세요 — ${diagReason}` : undefined
  const version = health?.version
    ? `v${health.version}${buildLabel(health.built_at) ? ` · ${buildLabel(health.built_at)}` : ''}`
    : null
  // 실행 중인 서버가 무엇인지 — 업데이트 뒤 다시 켰는지, 시세를 어디서 받는지 (예전 머리줄 배지의 풀이)
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
  const displayValue = `${prefs.choice === 'dark' ? '다크' : prefs.choice === 'light' ? '라이트' : '기기 설정'} · 상승 ${prefs.rise === 'red' ? '빨강' : '초록'}`

  return (
    <div className="settings-page">
      <div className="page-head">
        <h2>설정</h2>
      </div>

      {(signedIn || guest) && (
        <div className="settings-account">
          {signedIn ? (
            <>
              <span className="account-name">{user.name || user.email}</span>
              {user.name && user.email && <span className="menu-email">{user.email}</span>}
              <span className="menu-account-badges">
                {user.is_owner && <span className="badge badge-grey">관리자</span>}
                {pending && <span className="badge badge-amber">승인 대기</span>}
              </span>
            </>
          ) : (
            <>
              <span className="hint">로그인하면 내 종목과 알림을 쓸 수 있습니다.</span>
              {!pending && <LoginButton label="로그인" />}
            </>
          )}
        </div>
      )}

      <Group title="보기">
        <Row face={tfScreen} label="화면" value={displayValue} title="테마 · 상승 색" onClick={() => setShowDisplay(true)} />
        {member && <Row face={tfBell} label="알림" onClick={() => setShowPush(true)} />}
        {install.available && <Row face={tfInstall} label="앱 설치" title="홈 화면에 앱으로 추가합니다" onClick={install.start} />}
      </Group>

      {(member || isAdmin || canLogout || canWithdraw) && (
        <Group title="AI · 계정">
          {member && <Row face={tfKey} label="AI 키" onClick={() => setShowAi(true)} />}
          {isAdmin && (
            <Row
              face={tfDiag}
              label="진단"
              title={diagDot ?? '서버가 남긴 경고·오류 보기'}
              badge={diagDot && <span className="badge badge-amber count-badge" aria-label={diagDot}>!</span>}
              onClick={() => setShowDiagnostics(true)}
            />
          )}
          {isAdmin && mode === 'google' && (
            <Row
              face={tfUsers}
              label="사용자"
              title={pendingCount > 0 ? `가입 신청 ${pendingCount}건이 기다리고 있습니다` : '사용자 목록'}
              badge={
                pendingCount > 0 && (
                  <span className="badge badge-amber count-badge" aria-label={`가입 신청 ${pendingCount}건`}>
                    {pendingCount}
                  </span>
                )
              }
              onClick={() => setShowUsers(true)}
            />
          )}
          {canLogout && <Row face={tfDoor} label="나가기" title="이 기기에서 나가기" onClick={() => void logout()} />}
          {canLogoutAll && <Row label="모든 기기에서 나가기" onClick={() => setConfirmEverywhere(true)} />}
          {canWithdraw && <Row label="탈퇴" danger onClick={() => setConfirmWithdraw(true)} />}
        </Group>
      )}

      <Group title="정보">
        <Row face={tfDoc} label="개인정보처리방침 · 이용약관" to={POLICY_PATH} />
        <details className="settings-credits">
          <summary className="settings-row">
            <img className="settings-face" src={tfScroll} alt="" width={24} height={24} />
            <span className="settings-label">만든 것들 · 글꼴 · 그림</span>
            <Icon name="chevronDown" size={18} className="settings-go" />
          </summary>
          <ul>
            <li>
              Pretendard — Kil Hyung-jin · SIL Open Font License 1.1 (<a href="/licenses/pretendard.txt">전문</a>)
            </li>
            <li>
              Spoqa Han Sans Neo — Spoqa · SIL Open Font License 1.1 (<a href="/licenses/spoqa-han-sans-neo.txt">전문</a>)
            </li>
            <li>
              토스페이스 — © Viva Republica, Inc. · 토스페이스 라이선스 (<a href="/licenses/tossface.txt">전문</a>). 원본 그대로
              씁니다.
            </li>
          </ul>
        </details>
      </Group>

      {version && (
        <p className="hint mono settings-version" title={versionTitle}>
          {version}
        </p>
      )}

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

      {confirmEverywhere && (
        <ConfirmDialog
          title="모든 기기에서 나갈까요?"
          confirmLabel="모든 기기에서 나가기"
          busyLabel="나가는 중…"
          busy={leavingEverywhere}
          onConfirm={() => void doLogoutEverywhere()}
          onCancel={() => {
            setConfirmEverywhere(false)
            setEverywhereError(null)
          }}
        >
          <p>
            이 기기와 다른 모든 기기에서 나갑니다. 다른 기기는 다음에 열 때 로그인 화면이 되고, <strong>모든 기기의 알림이
            꺼집니다.</strong>
          </p>
          <p className="hint">
            잃어버린 기기에 저장된 AI 키는 여기서 지울 수 없으니, AI 회사에서 키를 새로 발급하세요. 내 종목과 기록은 그대로
            있습니다.
          </p>
          {everywhereError && <p className="error-text">{everywhereError}</p>}
        </ConfirmDialog>
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
    </div>
  )
}
