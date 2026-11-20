import type { IconName } from '../components/icons/iconPaths'

export interface Tab {
  to: string
  label: string
  icon: IconName
  /** 이 탭에 속하는 다른 주소 — 거기 있어도 이 탭이 켜진다 */
  also?: string[]
}

/**
 * 탭 다섯 (디자인 4차 묶음 2 — 주인: "처음부터 없는 상태로 디자인한다고 생각해. B 좋아").
 * 홈 · 종목 · 리밸런싱 · 매크로 · 설정. 더보기도, 머리줄 ⋯ 메뉴도 없다 — 숨은 곳이 없다.
 * 재무 · 차트는 종목 안(/stocks/:ticker)의 탭이다(묶음 3). 여러 종목 PER 비교(/fundamentals)에 있어도 종목 탭이 켜진다.
 */
export const TABS: Tab[] = [
  { to: '/', label: '홈', icon: 'home', also: ['/ai'] },
  { to: '/stocks', label: '종목', icon: 'stocks', also: ['/fundamentals'] },
  { to: '/rebalance', label: '리밸런싱', icon: 'rebalance' },
  { to: '/macro', label: '매크로', icon: 'macro' },
  { to: '/settings', label: '설정', icon: 'settings' },
]

function under(pathname: string, path: string): boolean {
  return pathname === path || pathname.startsWith(`${path}/`)
}

export function activeTab(pathname: string): string {
  for (const tab of TABS) {
    if (tab.to !== '/' && (under(pathname, tab.to) || tab.also?.some((p) => under(pathname, p)))) return tab.to
  }
  if (TABS[0].also?.some((p) => under(pathname, p))) return '/'
  return pathname === '/' ? '/' : ''
}


/**
 * PC 위 메뉴 (디자인 5차 목업 01 다 · 01e — 주인 고름). 홈 · 재무 · 리밸런싱 · 매크로.
 * 종목 메뉴는 없다 — 홈 안에 보유 종목 · 관심 종목 · 시그널이 있고, 종목 안(/stocks/:ticker)은 이름을 눌러 들어간다.
 * 설정은 오른쪽 위 톱니. 폰 아래 탭(TABS)은 5차 ④ 에서 정한다 — 그때까지 그대로.
 */
export const PC_TABS: Tab[] = [
  { to: '/', label: '홈', icon: 'home', also: ['/ai', '/stocks'] },
  { to: '/fundamentals', label: '재무', icon: 'doc' },
  { to: '/rebalance', label: '리밸런싱', icon: 'rebalance' },
  { to: '/macro', label: '매크로', icon: 'macro' },
]

export function activePcTab(pathname: string): string {
  for (const tab of PC_TABS) {
    if (tab.to !== '/' && under(pathname, tab.to)) return tab.to
  }
  if (pathname === '/' || PC_TABS[0].also?.some((p) => under(pathname, p))) return '/'
  return ''
}
