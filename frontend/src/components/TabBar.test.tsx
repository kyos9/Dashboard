/**
 * 화면 탭 (디자인 4차 묶음 2 — 주인: 탭 구성 B, "처음부터 없는 상태로 디자인한다고 생각해").
 *
 * 홈 · 종목 · 리밸런싱 · 매크로 · 설정 다섯. 더보기도 머리줄 ⋯ 메뉴도 없다.
 * PC 는 왼쪽 메뉴(목업 09b A), 폰은 화면 아래. 재무 · 차트는 종목 안으로 갈 때까지 종목 탭에 속한다.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { forgetPhone, pretendPhone } from '../test/phone'
import { activeTab } from '../lib/tabs'
import { TabBar } from './TabBar'

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>
}

function renderTabs(at = '/') {
  return render(
    <MemoryRouter initialEntries={[at]}>
      <TabBar />
      <Routes>
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
}

function names(nav: HTMLElement) {
  return Array.from(nav.querySelectorAll('a')).map((el) => el.textContent?.replace(/\d+$/, ''))
}

afterEach(() => forgetPhone())

describe('PC — 왼쪽 메뉴', () => {
  it('다섯 탭이 주인이 고른 순서로, 아이콘과 이름. 더보기 없음', () => {
    renderTabs()
    const nav = screen.getByRole('navigation', { name: '화면' })
    expect(nav).toHaveClass('side-nav')
    expect(names(nav)).toEqual(['홈', '종목', '리밸런싱', '매크로', '설정'])
    expect(nav.querySelectorAll('svg[data-icon]')).toHaveLength(5)
    expect(screen.queryByRole('button', { name: /더보기/ })).not.toBeInTheDocument()
  })

  it('켜진 탭은 그림 속을 채운다 — 나머지는 선만', () => {
    renderTabs('/macro')
    const on = screen.getByRole('link', { name: '매크로' })
    expect(on).toHaveAttribute('aria-current', 'page')
    expect(on.querySelector('path[fill="currentColor"]')).not.toBeNull()
    expect(screen.getByRole('link', { name: '홈' }).querySelector('path[fill="currentColor"]')).toBeNull()
  })
})

describe('폰 — 아래 탭', () => {
  it('다섯 탭, 누르면 그 화면', async () => {
    pretendPhone()
    renderTabs()
    const nav = screen.getByRole('navigation', { name: '화면' })
    expect(nav).toHaveClass('bottom-tabs')
    expect(names(nav)).toEqual(['홈', '종목', '리밸런싱', '매크로', '설정'])
    await userEvent.click(screen.getByRole('link', { name: '설정' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/settings')
    expect(screen.getByRole('link', { name: '설정' })).toHaveAttribute('aria-current', 'page')
  })
})

describe('어느 탭이 켜지나', () => {
  it.each([
    ['/', '/'],
    ['/ai/portfolio', '/'],
    ['/stocks', '/stocks'],
    ['/fundamentals', '/stocks'],
    ['/history', '/stocks'],
    ['/rebalance', '/rebalance'],
    ['/macro', '/macro'],
    ['/settings', '/settings'],
    ['/policy', ''],
  ])('%s → %s', (path, tab) => {
    expect(activeTab(path)).toBe(tab)
  })
})
