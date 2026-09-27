import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react'
import { usePopoverClose } from '../lib/popover'

export interface MenuItem {
  key: string
  label: ReactNode
  /** 글자 대신 읽힐 이름 (숫자 배지가 붙은 항목 등) */
  ariaLabel?: string
  title?: string
  danger?: boolean
  onSelect: () => void
}

interface Props {
  items: MenuItem[]
  /** 맨 위 — 누구로 들어와 있는지 */
  head?: ReactNode
  /** 맨 아래 — 버전 */
  foot?: ReactNode
  /** 가입 신청 수. 메뉴를 열지 않아도 보이게 버튼에 붙인다 */
  badge?: number
}

/**
 * 헤더의 ⋯ 메뉴 (ROADMAP 8-2).
 *
 * 폰 헤더를 한 줄로 만들려고 버튼을 여기로 모았다 — 진단·사용자·알림·AI 키·설치·테마·나가기·탈퇴.
 * PC 에서는 관리자 도구(진단·사용자)만 들어온다.
 *
 * 항목을 누르면 메뉴를 **먼저 닫고** 그 일을 한다. 항목이 팝업을 열면 메뉴가 쌓아 둔 뒤로가기
 * 칸을 팝업이 그대로 이어 쓴다 — 뒤로가기 한 번에 팝업이 닫히고 보던 화면이 남는다.
 */
export function HeaderMenu({ items, head, foot, badge = 0 }: Props) {
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  const toggle = useRef<HTMLButtonElement>(null)
  const id = useId()

  return (
    <div className="header-menu" ref={wrap}>
      <button
        ref={toggle}
        className="ghost menu-btn"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={badge > 0 ? `메뉴 — 가입 신청 ${badge}건` : '메뉴'}
        title="메뉴"
        onClick={() => setOpen((o) => !o)}
      >
        {/* 글자(⋯)는 폰 글꼴마다 크기·굵기가 달라 그림으로 그린다 */}
        <svg className="menu-glyph" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <circle cx="5" cy="12" r="1.9" fill="currentColor" />
          <circle cx="12" cy="12" r="1.9" fill="currentColor" />
          <circle cx="19" cy="12" r="1.9" fill="currentColor" />
        </svg>
        {badge > 0 && (
          <span className="menu-badge" aria-hidden="true">
            {badge}
          </span>
        )}
      </button>
      {open && (
        <MenuPanel
          id={id}
          wrap={wrap}
          toggle={toggle}
          items={items}
          head={head}
          foot={foot}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  )
}

function MenuPanel({
  id,
  wrap,
  toggle,
  items,
  head,
  foot,
  onClose,
}: Omit<Props, 'badge'> & {
  id: string
  wrap: RefObject<HTMLDivElement | null>
  toggle: RefObject<HTMLButtonElement | null>
  onClose: () => void
}) {
  usePopoverClose(wrap, toggle, onClose)
  const panel = useRef<HTMLDivElement>(null)

  // 키보드로 열었으면 첫 항목에서 시작한다
  useEffect(() => {
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
  }, [])

  return (
    <div className="menu-panel" id={id} role="group" aria-label="메뉴" ref={panel}>
      {head && <div className="menu-head">{head}</div>}
      {items.map((item) => (
        <button
          key={item.key}
          className={`menu-item${item.danger ? ' danger' : ''}`}
          aria-label={item.ariaLabel}
          title={item.title}
          onClick={() => {
            onClose()
            item.onSelect()
          }}
        >
          {item.label}
        </button>
      ))}
      {foot && <div className="menu-foot">{foot}</div>}
    </div>
  )
}
