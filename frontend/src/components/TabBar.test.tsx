/**
 * 화면 탭 (디자인 4차 묶음 2 — 주인: 탭 구성 B, "처음부터 없는 상태로 디자인한다고 생각해").
 *
 * 홈 · 종목 · 리밸런싱 · 매크로 · 설정 다섯. 더보기도 머리줄 ⋯ 메뉴도 없다.
 * 폰은 화면 아래. PC 는 디자인 5차부터 위 메뉴(AppHeader) — 홈 · 재무 · 리밸런싱 · 매크로. 재무 · 차트는 종목 안으로 갈 때까지 종목 탭에 속한다.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { forgetPhone, pretendPhone } from '../test/phone'
import { activePcTab, activeTab } from '../lib/tabs'
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

describe('PC — 아래 탭은 그리지 않는다 (디자인 5차: 위 메뉴는 AppHeader)', () => {
  it('PC 폭에서는 탭 줄이 없다', () => {
    renderTabs()
    expect(screen.queryByRole('navigation', { name: '화면' })).not.toBeInTheDocument()
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

describe('제 주소가 아니어도 켜진 탭은 aria-current (묶음 2 검토 조건 2) — 폰', () => {
  it.each([
    ['/fundamentals', '종목'],
    ['/stocks/VOO', '종목'],
    ['/ai/portfolio', '홈'],
  ])('%s → %s', (path, name) => {
    pretendPhone()
    renderTabs(path)
    expect(screen.getByRole('link', { name })).toHaveAttribute('aria-current', 'page')
    expect(screen.getAllByRole('link').filter((a) => a.getAttribute('aria-current') === 'page')).toHaveLength(1)
  })
})

describe('PC 위 메뉴 — 어느 메뉴가 켜지나 (디자인 5차)', () => {
  it.each([
    ['/', '/'],
    ['/ai/portfolio', '/'],
    ['/stocks/005930.KS', '/'],
    ['/fundamentals', '/fundamentals'],
    ['/rebalance', '/rebalance'],
    ['/macro', '/macro'],
    ['/settings', ''],
  ])('%s → %s', (path, tab) => {
    expect(activePcTab(path)).toBe(tab)
  })
})

describe('어느 탭이 켜지나', () => {
  it.each([
    ['/', '/'],
    ['/ai/portfolio', '/'],
    ['/stocks', '/stocks'],
    ['/fundamentals', '/stocks'],
    ['/stocks/005930.KS', '/stocks'],
    ['/rebalance', '/rebalance'],
    ['/macro', '/macro'],
    ['/settings', '/settings'],
    ['/policy', ''],
  ])('%s → %s', (path, tab) => {
    expect(activeTab(path)).toBe(tab)
  })
})
