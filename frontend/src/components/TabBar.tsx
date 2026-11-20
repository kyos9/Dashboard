import { Link, useLocation } from 'react-router-dom'
import { diagnosticsReason } from '../lib/refreshText'
import { useNarrow } from '../lib/narrow'
import { useAuth } from './AuthGate'
import { Icon } from './icons/Icon'
import { TABS, activeTab } from '../lib/tabs'

/**
 * 폰 화면 아래 탭(엄지가 닿는 자리). PC 는 위 메뉴(AppHeader, 디자인 5차 목업 01 다) — 여기서는 그리지 않는다.
 */
export function TabBar() {
  const narrow = useNarrow()
  const { pathname } = useLocation()
  const { isAdmin, pendingCount, backupAttention, refreshAttention } = useAuth()
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

  // PC 는 위 메뉴(AppHeader, 디자인 5차) — 여기서는 폰 아래 탭만 그린다
  if (!narrow) return null
  return (
    <nav className="bottom-tabs" aria-label="화면">
      {links}
    </nav>
  )
}
