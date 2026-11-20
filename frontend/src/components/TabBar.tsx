import { Link, useLocation } from 'react-router-dom'
import { diagnosticsReason } from '../lib/refreshText'
import { useNarrow } from '../lib/narrow'
import { useAuth } from './AuthGate'
import { Icon } from './icons/Icon'
import { TABS, activeTab } from '../lib/tabs'

/**
 * 폰은 화면 아래(엄지가 닿는 자리), PC 는 왼쪽 메뉴(목업 09b A). 그리는 것 자체를 가른다(같은 단추 두 벌을 만들지 않는다).
 */
export function TabBar() {
  const narrow = useNarrow()
  const { pathname } = useLocation()
  const { isAdmin, pendingCount, backupAttention, refreshAttention, user, mode, pending } = useAuth()
  const current = activeTab(pathname)
  // 관리자가 볼 것이 있으면 설정 탭에 점 — 예전 ⋯ 메뉴의 점과 숫자
  const diag = isAdmin ? diagnosticsReason(backupAttention, refreshAttention) : null
  const count = isAdmin ? pendingCount : 0
  // 숫자와 점은 같이 — 숫자가 점을 가리면 백업 · 시세 경고를 놓친다 (0.45.2 B4, 묶음 2 검토 조건 3)
  const settingsMark = (
    <>
      {count > 0 && (
        <span className="badge badge-amber count-badge tab-badge" aria-label={`가입 신청 ${count}건`}>
          {count}
        </span>
      )}
      {diag && (
        <span className={`tab-dot${count > 0 ? ' tab-dot-aside' : ''}`} aria-label={`서버 상태를 확인하세요 — ${diag}`} role="img" />
      )}
    </>
  )

  const links = TABS.map((tab) => {
    const on = current === tab.to
    return (
      // NavLink 는 제 주소일 때만 aria-current 를 붙인다 — 재무 · 차트(종목 탭) · AI 화면(홈 탭)에서도 켜지게 직접 정한다 (묶음 2 검토 조건 2)
      <Link
        key={tab.to}
        to={tab.to}
        className={narrow ? `bottom-tab${on ? ' active' : ''}` : `side-tab${on ? ' active' : ''}`}
        aria-current={on ? 'page' : undefined}
      >
        <span className="tab-ico">
          <Icon name={tab.icon} active={on} size={24} />
          {tab.to === '/settings' && settingsMark}
        </span>
        <span className={narrow ? 'bottom-tab-label' : 'side-tab-label'}>{tab.label}</span>
      </Link>
    )
  })

  if (narrow)
    return (
      <nav className="bottom-tabs" aria-label="화면">
        {links}
      </nav>
    )
  return (
    <nav className="side-nav" aria-label="화면">
      <div className="side-brand">
        <span className="side-logo" aria-hidden="true">
          ₩
        </span>
        <span className="side-brand-name">자산관리</span>
      </div>
      {links}
      {/* 누구로 들어와 있는지 — 예전 PC 머리줄 이름 칸이 하던 일 (목업 09b A, 묶음 2 검토 조건 6). 누르면 설정 */}
      {mode === 'google' && user && (
        <Link to="/settings" className="side-account" title={user.email ?? undefined}>
          <span className="side-account-name">{user.name || user.email}</span>
          <span className="side-account-sub">
            {user.is_owner ? '관리자' : pending ? '승인 대기' : user.email}
          </span>
        </Link>
      )}
    </nav>
  )
}
