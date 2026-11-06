import { NavLink, useLocation } from 'react-router-dom'
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
  const { isAdmin, pendingCount, backupAttention, refreshAttention } = useAuth()
  const current = activeTab(pathname)
  // 관리자가 볼 것이 있으면 설정 탭에 점 — 예전 ⋯ 메뉴의 점과 숫자
  const diag = isAdmin ? diagnosticsReason(backupAttention, refreshAttention) : null
  const count = isAdmin ? pendingCount : 0
  const settingsMark =
    count > 0 ? (
      <span className="badge badge-amber count-badge tab-badge" aria-label={`가입 신청 ${count}건`}>
        {count}
      </span>
    ) : diag ? (
      <span className="tab-dot" aria-label={`진단을 확인하세요 — ${diag}`} />
    ) : null

  const links = TABS.map((tab) => {
    const on = current === tab.to
    return (
      <NavLink
        key={tab.to}
        to={tab.to}
        end={tab.to === '/'}
        className={narrow ? `bottom-tab${on ? ' active' : ''}` : `side-tab${on ? ' active' : ''}`}
        aria-current={on ? 'page' : undefined}
      >
        <span className="tab-ico">
          <Icon name={tab.icon} active={on} size={24} />
          {tab.to === '/settings' && settingsMark}
        </span>
        <span className={narrow ? 'bottom-tab-label' : 'side-tab-label'}>{tab.label}</span>
      </NavLink>
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
    </nav>
  )
}
