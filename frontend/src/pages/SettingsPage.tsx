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
import { useMedia, useNarrow } from '../lib/narrow'
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

type Pane = 'display' | 'push' | 'ai' | 'diag' | 'users' | 'account' | 'credits'

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
  const [confirmLogout, setConfirmLogout] = useState(false)
  const [confirmWithdraw, setConfirmWithdraw] = useState(false)
  const [withdrawing, setWithdrawing] = useState(false)
  const [withdrawError, setWithdrawError] = useState<string | null>(null)
  const [confirmEverywhere, setConfirmEverywhere] = useState(false)
  const [leavingEverywhere, setLeavingEverywhere] = useState(false)
  const [everywhereError, setEverywhereError] = useState<string | null>(null)
  const [health, setHealth] = useState<HealthInfo | null>(null)
  const prefs = usePrefs()
  // PC 는 왼쪽 메뉴 + 오른쪽 내용 (디자인 5차 목업 08 가). 폭 1100 이하 · 폰은 목록 + 창 그대로 — ④ 에서
  const narrow = useNarrow()
  const compact = useMedia('(max-width: 1100px)') || narrow
  const [pane, setPane] = useState<Pane>('display')

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
  const diagDot = diagReason ? `서버 상태를 확인하세요 — ${diagReason}` : undefined
  const version = health?.version
    ? `v${health.version}${buildLabel(health.built_at) ? ` (${buildLabel(health.built_at)})` : ''}`
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
  const displayValue = `${prefs.choice === 'dark' ? '어둡게' : prefs.choice === 'light' ? '밝게' : '기기 설정'}, 상승 ${prefs.rise === 'red' ? '빨강' : '초록'}`

  const noop = () => {}
  const credits = (
    <ul className="settings-credits-list">
      <li>
        Pretendard — Kil Hyung-jin, SIL Open Font License 1.1 (<a href="/licenses/pretendard.txt">전문</a>)
      </li>
      <li>
        Spoqa Han Sans Neo — Spoqa, SIL Open Font License 1.1 (<a href="/licenses/spoqa-han-sans-neo.txt">전문</a>)
      </li>
      <li>
        토스페이스 — © Viva Republica, Inc., 토스페이스 라이선스 (<a href="/licenses/tossface.txt">전문</a>). 원본 그대로 씁니다.
      </li>
    </ul>
  )
  const confirms = (
    <>
      {confirmLogout && (
        <ConfirmDialog
          title="이 기기에서 나갈까요?"
          confirmLabel="나가기"
          busyLabel="나가는 중…"
          busy={false}
          onConfirm={() => void logout()}
          onCancel={() => setConfirmLogout(false)}
        >
          <p>다시 쓰려면 로그인해야 합니다. 내 종목과 기록은 그대로 있습니다.</p>
        </ConfirmDialog>
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
    </>
  )

  if (!compact) {
    const showAccount = canLogout || canLogoutAll || canWithdraw
    const item = (key: Pane, label: ReactNode, value?: ReactNode) => (
      <li key={key} role="option" aria-selected={pane === key}>
        <button type="button" className={`sig-item settings-item${pane === key ? ' active' : ''}`} onClick={() => setPane(key)}>
          <span>{label}</span>
          {value != null && <span className="settings-item-value">{value}</span>}
        </button>
      </li>
    )
    const group = (title: string) => (
      <li className="fd-group" role="presentation">
        {title}
      </li>
    )
    // 고를 수 없는 칸을 가리키고 있으면(권한이 바뀌는 등) 화면으로
    const avail: Pane[] = [
      'display',
      ...(member ? (['push', 'ai'] as Pane[]) : []),
      ...(isAdmin ? (['diag'] as Pane[]) : []),
      ...(isAdmin && mode === 'google' ? (['users'] as Pane[]) : []),
      ...(showAccount ? (['account'] as Pane[]) : []),
      'credits',
    ]
    const current = avail.includes(pane) ? pane : 'display'
    const loading = (title: string) => <p className="hint settings-pane">{title} 불러오는 중…</p>
    return (
      <div className="settings-page settings-page-pc">
        <div className="page-head">
          <h2>설정</h2>
        </div>
        <div className="sig-panel settings-panel-pc">
          <div>
            <ul className="sig-list settings-list-pc" role="listbox" aria-label="설정">
              {(signedIn || guest) && (
                <li className="settings-me" role="presentation">
                  {signedIn ? (
                    <>
                      <b>{user.name || user.email}</b>
                      {user.is_owner && <span className="badge badge-grey">관리자</span>}
                      {pending && <span className="badge badge-amber">승인 대기</span>}
                      {user.name && user.email && <span className="hint">{user.email}</span>}
                    </>
                  ) : (
                    <>
                      <span className="hint">로그인하면 내 종목과 알림을 쓸 수 있습니다.</span>
                      {!pending && <LoginButton label="로그인" />}
                    </>
                  )}
                </li>
              )}
              {group('보기')}
              {item('display', '화면', displayValue)}
              {member && item('push', '알림')}
              {member && group('AI')}
              {member && item('ai', 'AI 키')}
              {isAdmin && group('관리')}
              {isAdmin &&
                item(
                  'diag',
                  '서버 상태',
                  diagDot && (
                    <span className="badge badge-amber count-badge" aria-label={diagDot} title={diagDot}>
                      확인
                    </span>
                  ),
                )}
              {isAdmin &&
                mode === 'google' &&
                item(
                  'users',
                  '사용자',
                  pendingCount > 0 && (
                    <span className="badge badge-amber count-badge" aria-label={`가입 신청 ${pendingCount}건`}>
                      대기 {pendingCount}
                    </span>
                  ),
                )}
              {showAccount && group('계정')}
              {showAccount && item('account', '나가기')}
              {group('정보')}
              <li role="presentation">
                <Link className="sig-item settings-item" to={POLICY_PATH}>
                  개인정보처리방침과 이용약관
                </Link>
              </li>
              {item('credits', '만든 이와 글꼴', version && <span className="mono">{version}</span>)}
              {install.available && (
                <li role="presentation">
                  <button type="button" className="sig-item settings-item" onClick={install.start}>
                    앱 설치
                  </button>
                </li>
              )}
            </ul>
          </div>
          <div className="sig-detail settings-detail">
            {current === 'display' && (
              <Suspense fallback={loading('화면')}>
                <DisplayModal inline onClose={noop} />
              </Suspense>
            )}
            {current === 'push' && (
              <Suspense fallback={loading('알림')}>
                <PushModal inline account={account} onClose={noop} />
              </Suspense>
            )}
            {current === 'ai' && (
              <Suspense fallback={loading('AI 키')}>
                <AiKeyModal inline account={account} onClose={noop} />
              </Suspense>
            )}
            {current === 'diag' && (
              <Suspense fallback={loading('서버 상태')}>
                <DiagnosticsModal inline onClose={noop} />
              </Suspense>
            )}
            {current === 'users' && (
              <Suspense fallback={loading('사용자')}>
                <UsersModal inline onClose={noop} onChanged={recountPending} />
              </Suspense>
            )}
            {current === 'account' && (
              <section className="settings-pane" aria-label="나가기">
                <div className="modal-head settings-pane-head">
                  <div className="modal-title">
                    <h3>나가기</h3>
                    {signedIn && <span className="hint">{user.email}</span>}
                  </div>
                </div>
                <div className="settings-actions">
                  {canLogout && (
                    <button type="button" onClick={() => setConfirmLogout(true)}>
                      이 기기에서 나가기
                    </button>
                  )}
                  {canLogoutAll && (
                    <button type="button" onClick={() => setConfirmEverywhere(true)}>
                      모든 기기에서 나가기
                    </button>
                  )}
                  {canWithdraw && (
                    <button type="button" className="danger" onClick={() => setConfirmWithdraw(true)}>
                      탈퇴
                    </button>
                  )}
                </div>
                <p className="hint">
                  나가도 내 종목과 기록은 그대로 있습니다.{canWithdraw && ' 탈퇴는 모두 지우고 되돌릴 수 없습니다.'}
                </p>
              </section>
            )}
            {current === 'credits' && (
              <section className="settings-pane" aria-label="만든 이와 글꼴">
                <div className="modal-head settings-pane-head">
                  <div className="modal-title">
                    <h3>만든 이와 글꼴</h3>
                    {version && (
                      <span className="hint mono" title={versionTitle}>
                        {version}
                      </span>
                    )}
                  </div>
                </div>
                {credits}
              </section>
            )}
          </div>
        </div>
        {install.hint}
        {confirms}
      </div>
    )
  }

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
        <Group title="AI와 계정">
          {member && <Row face={tfKey} label="AI 키" onClick={() => setShowAi(true)} />}
          {isAdmin && (
            <Row
              face={tfDiag}
              label="서버 상태"
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
          {canLogout && <Row face={tfDoor} label="나가기" title="이 기기에서 나가기" onClick={() => setConfirmLogout(true)} />}
          {canLogoutAll && <Row label="모든 기기에서 나가기" onClick={() => setConfirmEverywhere(true)} />}
          {canWithdraw && <Row label="탈퇴" danger onClick={() => setConfirmWithdraw(true)} />}
        </Group>
      )}

      <Group title="정보">
        <Row face={tfDoc} label="개인정보처리방침과 이용약관" to={POLICY_PATH} />
        <details className="settings-credits">
          <summary className="settings-row">
            <img className="settings-face" src={tfScroll} alt="" width={24} height={24} />
            <span className="settings-label">만든 이와 글꼴</span>
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
        <Suspense fallback={<ModalLoading plain title="서버 상태" onClose={() => setShowDiagnostics(false)} />}>
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

      {/* 설정 줄은 잘못 누르기 쉽다 — 한 번 묻는다 (주인 답, 2026-11-06) */}
      {confirmLogout && (
        <ConfirmDialog
          title="이 기기에서 나갈까요?"
          confirmLabel="나가기"
          busyLabel="나가는 중…"
          busy={false}
          onConfirm={() => void logout()}
          onCancel={() => setConfirmLogout(false)}
        >
          <p>다시 쓰려면 로그인해야 합니다. 내 종목과 기록은 그대로 있습니다.</p>
        </ConfirmDialog>
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
