/**
 * 화면 탭 (ROADMAP 8-2) — PC 는 위 한 줄, 폰은 아래 탭 + 더보기.
 *
 * 순서는 주인이 정했다: 대시보드 · 재무 · 리밸런싱 · 매크로 · 더보기(차트·종목 관리).
 */
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BrowserRouter, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetBackToClose } from '../lib/backToClose'
import { forgetPhone, pretendPhone } from '../test/phone'
import { TabBar } from './TabBar'

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>
}

function renderTabs(Router: typeof MemoryRouter | typeof BrowserRouter = MemoryRouter, at = '/') {
  return render(
    <Router {...(Router === MemoryRouter ? { initialEntries: [at] } : {})}>
      <TabBar />
      <Routes>
        <Route path="*" element={<Where />} />
      </Routes>
    </Router>,
  )
}

function names(container: HTMLElement) {
  return Array.from(container.querySelectorAll('a, button')).map((el) => el.textContent)
}

async function back() {
  await act(async () => {
    window.history.back()
    await new Promise((r) => setTimeout(r, 30))
  })
}

beforeEach(() => {
  resetBackToClose()
  window.history.replaceState({ idx: 0, key: 'base' }, '', '/')
})

afterEach(() => forgetPhone())

describe('PC', () => {
  it('위에 여섯 탭 한 줄 — 주인이 정한 순서, 더보기 없음', () => {
    renderTabs()
    const nav = screen.getByRole('navigation', { name: '화면' })
    expect(nav).toHaveClass('tabs')
    expect(names(nav)).toEqual(['대시보드', '재무', '리밸런싱', '매크로', '차트', '종목 관리'])
    expect(screen.queryByRole('button', { name: /더보기/ })).not.toBeInTheDocument()
  })
})

describe('폰 아래 탭', () => {
  beforeEach(() => {
    pretendPhone()
  })

  it('넷 + 더보기. 차트·종목 관리는 더보기를 열어야 보인다', async () => {
    renderTabs()
    const nav = screen.getByRole('navigation', { name: '화면' })
    expect(nav).toHaveClass('bottom-tabs')
    expect(names(nav)).toEqual(['대시보드', '재무', '리밸런싱', '매크로', '더보기'])
    expect(screen.getByRole('link', { name: '대시보드' })).toHaveAttribute('aria-current', 'page')

    await userEvent.click(screen.getByRole('button', { name: '더보기' }))
    const sheet = screen.getByRole('group', { name: '더보기' })
    expect(names(sheet)).toEqual(['차트', '종목 관리'])
  })

  it('더보기에서 고르면 그 화면으로 가고, 더보기 자리에 지금 화면 이름이 켜진다', async () => {
    renderTabs()
    await userEvent.click(screen.getByRole('button', { name: '더보기' }))
    await userEvent.click(screen.getByRole('link', { name: '종목 관리' }))

    expect(screen.getByTestId('where')).toHaveTextContent('/stocks')
    expect(screen.queryByRole('group', { name: '더보기' })).not.toBeInTheDocument()
    const more = screen.getByRole('button', { name: '종목 관리' })
    expect(more).toHaveAttribute('aria-current', 'page')
    expect(more).toHaveClass('active')
    expect(screen.getByRole('link', { name: '대시보드' })).not.toHaveAttribute('aria-current')
  })

  it('차트 화면에서 열면 더보기 칸이 "차트"로 켜져 있다', () => {
    renderTabs(MemoryRouter, '/history')
    expect(screen.getByRole('button', { name: '차트' })).toHaveAttribute('aria-current', 'page')
  })

  it('바깥을 누르면 닫힌다', async () => {
    renderTabs()
    await userEvent.click(screen.getByRole('button', { name: '더보기' }))
    await userEvent.click(screen.getByTestId('where'))
    expect(screen.queryByRole('group', { name: '더보기' })).not.toBeInTheDocument()
  })

  it('Esc 로 닫고 초점은 더보기로', async () => {
    renderTabs()
    await userEvent.click(screen.getByRole('button', { name: '더보기' }))
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('group', { name: '더보기' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '더보기' })).toHaveFocus()
  })

  it('뒤로가기는 더보기만 닫는다 — 화면은 그대로', async () => {
    renderTabs(BrowserRouter)
    await userEvent.click(screen.getByRole('link', { name: '매크로' }))
    await userEvent.click(screen.getByRole('button', { name: '더보기' }))
    await back()
    expect(screen.queryByRole('group', { name: '더보기' })).not.toBeInTheDocument()
    expect(screen.getByTestId('where')).toHaveTextContent('/macro')
  })

  it('더보기로 간 화면에서 뒤로가기 한 번이면 앞 화면 — 헛도는 칸이 없다', async () => {
    renderTabs(BrowserRouter)
    await userEvent.click(screen.getByRole('link', { name: '매크로' }))
    await userEvent.click(screen.getByRole('button', { name: '더보기' }))
    await userEvent.click(screen.getByRole('link', { name: '차트' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/history')

    await back()
    expect(screen.getByTestId('where')).toHaveTextContent('/macro')
    // 한 번 더 — 더보기가 쌓았던 칸(주소는 /macro)이 남아 있으면 여기서 제자리걸음을 한다
    await back()
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/$/)
  })
})
