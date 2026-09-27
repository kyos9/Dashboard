import { useId, useRef, useState, type ReactNode, type RefObject } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useNarrow } from '../lib/narrow'
import { usePopoverClose } from '../lib/popover'

interface Tab {
  to: string
  label: string
  end?: boolean
  icon: ReactNode
}

/** 선만 쓰는 작은 그림 — 글자와 같은 색(currentColor)을 따라 켜지고 꺼진다 */
function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      className="tab-icon"
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

/** 탭 순서는 주인이 정했다 — 대시보드 · 재무 · 리밸런싱 · 매크로, 나머지는 더보기 (ROADMAP 8-2) */
const MAIN: Tab[] = [
  {
    to: '/',
    label: '대시보드',
    end: true,
    icon: (
      <Icon>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 3.5V12h8.5" />
      </Icon>
    ),
  },
  {
    to: '/fundamentals',
    label: '재무',
    icon: (
      <Icon>
        <rect x="5" y="3.5" width="14" height="17" rx="2" />
        <path d="M9 8.5h6M9 12h6M9 15.5h3.5" />
      </Icon>
    ),
  },
  {
    to: '/rebalance',
    label: '리밸런싱',
    icon: (
      <Icon>
        <path d="M12 4v15.5M7 19.5h10M5.5 7.5h13M6 7.5l-2.8 6h5.6zM18 7.5l-2.8 6h5.6z" />
      </Icon>
    ),
  },
  {
    to: '/macro',
    label: '매크로',
    icon: (
      <Icon>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M3.5 12h17M12 3.5c3 3.2 3 13.8 0 17M12 3.5c-3 3.2-3 13.8 0 17" />
      </Icon>
    ),
  },
]

/** 차트는 종목 이름을 누르면 어디서든 뜨므로 더보기로 간다 */
const MORE: Omit<Tab, 'icon'>[] = [
  { to: '/history', label: '차트' },
  { to: '/stocks', label: '종목 관리' },
]

const tabClass = ({ isActive }: { isActive: boolean }) => `tab${isActive ? ' active' : ''}`

/**
 * 화면 탭. PC 는 헤더 아래 한 줄, 폰은 화면 아래에 붙는다 (ROADMAP 8-2).
 *
 * 폰 아래 탭은 엄지가 닿는 자리이고, 설치한 앱에는 주소창이 없어서 이것이 앱의 모양이 된다.
 */
export function TabBar() {
  const narrow = useNarrow()
  if (narrow) return <BottomTabs />
  return (
    <nav className="tabs" aria-label="화면">
      {[...MAIN, ...MORE].map((tab) => (
        <NavLink key={tab.to} to={tab.to} end={tab.end} className={tabClass}>
          {tab.label}
        </NavLink>
      ))}
    </nav>
  )
}

function BottomTabs() {
  const [moreOpen, setMoreOpen] = useState(false)
  const { pathname } = useLocation()
  const wrap = useRef<HTMLDivElement>(null)
  const toggle = useRef<HTMLButtonElement>(null)
  const id = useId()
  // 더보기 안의 화면에 있으면 더보기가 켜진다 — 지금 어디인지 아래 탭만 봐도 안다
  const inMore = MORE.some((tab) => pathname === tab.to || pathname.startsWith(`${tab.to}/`))
  const current = MORE.find((tab) => pathname === tab.to || pathname.startsWith(`${tab.to}/`))

  return (
    <nav className="bottom-tabs" aria-label="화면">
      {MAIN.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.end}
          className={({ isActive }) => `bottom-tab${isActive ? ' active' : ''}`}
        >
          {tab.icon}
          <span className="bottom-tab-label">{tab.label}</span>
        </NavLink>
      ))}
      <div className="bottom-more" ref={wrap}>
        <button
          ref={toggle}
          className={`bottom-tab${inMore ? ' active' : ''}`}
          aria-expanded={moreOpen}
          aria-controls={moreOpen ? id : undefined}
          aria-current={inMore ? 'page' : undefined}
          onClick={() => setMoreOpen((o) => !o)}
        >
          <Icon>
            <circle cx="5.5" cy="12" r="1.3" fill="currentColor" />
            <circle cx="12" cy="12" r="1.3" fill="currentColor" />
            <circle cx="18.5" cy="12" r="1.3" fill="currentColor" />
          </Icon>
          <span className="bottom-tab-label">{current ? current.label : '더보기'}</span>
        </button>
        {moreOpen && <MoreSheet id={id} wrap={wrap} toggle={toggle} onClose={() => setMoreOpen(false)} />}
      </div>
    </nav>
  )
}

function MoreSheet({
  id,
  wrap,
  toggle,
  onClose,
}: {
  id: string
  wrap: RefObject<HTMLDivElement | null>
  toggle: RefObject<HTMLButtonElement | null>
  onClose: () => void
}) {
  usePopoverClose(wrap, toggle, onClose)
  return (
    <div className="more-sheet" id={id} role="group" aria-label="더보기">
      {MORE.map((tab) => (
        // 판이 쌓아 둔 뒤로가기 칸을 새 화면으로 **바꿔 쓴다**(replace). 쌓으면 그 칸이 남아
        // 뒤로가기를 한 번 더 눌러야 앞 화면으로 간다.
        <NavLink key={tab.to} to={tab.to} replace className={tabClass} onClick={onClose}>
          {tab.label}
        </NavLink>
      ))}
    </div>
  )
}
