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

