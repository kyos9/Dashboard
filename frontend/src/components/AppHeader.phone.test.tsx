/**
 * 폰 헤더 한 줄 + ⋯ 메뉴 (ROADMAP 8-2).
 *
 * 지킬 것: 폰 헤더에는 로고·상태·새로고침·로그인·메뉴만 있다. 나머지 버튼은 메뉴 안에 있고,
 * 누가 들어왔는지에 따라 PC 와 같은 것만 보인다(관리자 도구가 사용자에게 새지 않는다).
 * 메뉴는 바깥·Esc·다시 누르기·뒤로가기로 닫히고, 뒤로가기는 메뉴만 닫는다.
 */
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BrowserRouter, MemoryRouter, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppStateProvider } from '../AppState'
import { api } from '../api/client'
import { resetBackToClose } from '../lib/backToClose'
import { forgetPhone, pretendPhone } from '../test/phone'
import type { AuthStatus } from '../types'
import { AppHeader } from './AppHeader'
import { AuthGate } from './AuthGate'

const FRIEND: AuthStatus = {
  locked: true,
  authenticated: true,
  mode: 'google',
  config_problem: null,
  user: { email: 'friend@example.com', name: '친구', is_owner: false, status: 'active' },
}
const OWNER: AuthStatus = {
  locked: true,
  authenticated: true,
  mode: 'google',
  config_problem: null,
  pending_count: 2,
  user: { email: 'me@example.com', name: '나', is_owner: true, status: 'active' },
}
const GUEST: AuthStatus = { locked: true, authenticated: false, mode: 'google', user: null, config_problem: null }

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>
}

function renderAs(status: AuthStatus, Router: typeof MemoryRouter | typeof BrowserRouter = MemoryRouter) {
  vi.spyOn(api, 'getHealth').mockResolvedValue({ status: 'ok', version: '0.31.0', revision: 'abc1234' })
  vi.spyOn(api, 'getAuthStatus').mockResolvedValue(status)
  return render(
    <Router>
      <AuthGate>
        <AppStateProvider>
          <AppHeader />
          <NavLink to="/rebalance">리밸런싱으로</NavLink>
          <Routes>
            <Route path="*" element={<Where />} />
          </Routes>
        </AppStateProvider>
      </AuthGate>
    </Router>,
  )
}

/** 헤더(위쪽 한 줄)에 바로 보이는 버튼 이름들 — 메뉴 안은 빼고 */
function headerButtons() {
  const header = document.querySelector('header.app-header') as HTMLElement
  return within(header)
    .queryAllByRole('button')
    .filter((b) => !b.closest('.menu-panel'))
    .map((b) => b.getAttribute('aria-label') ?? b.textContent)
}

function menuButtons() {
  return within(screen.getByRole('group', { name: '메뉴' }))
    .getAllByRole('button')
    .map((b) => b.getAttribute('aria-label') ?? b.textContent)
}

async function openMenu() {
  await userEvent.click(await screen.findByRole('button', { name: /^메뉴/ }))
}

async function back() {
  await act(async () => {
    window.history.back()
    await new Promise((r) => setTimeout(r, 30))
  })
}

beforeEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
  resetBackToClose()
  window.history.replaceState({ idx: 0, key: 'base' }, '', '/')
  pretendPhone()
})

afterEach(() => forgetPhone())

describe('폰 헤더는 한 줄', () => {
  it('사용자: 헤더에는 메뉴 하나 — 알림·AI 키·화면 설정·나가기·탈퇴는 메뉴 안', async () => {
    renderAs(FRIEND)
    await screen.findByRole('button', { name: '메뉴' })
    expect(headerButtons()).toEqual(['메뉴'])
    expect(document.querySelector('.brand-sub')).toBeNull()

    await openMenu()
    expect(menuButtons()).toEqual(['알림 설정', 'AI 키 설정', '화면 설정', '나가기', '탈퇴'])
    // 누구로 들어왔는지는 메뉴 맨 위에
    const menu = screen.getByRole('group', { name: '메뉴' })
    expect(within(menu).getByText('친구')).toBeInTheDocument()
    expect(within(menu).getByText('friend@example.com')).toBeInTheDocument()
    expect(within(menu).getByText('v0.31.0')).toBeInTheDocument()
  })

  it('관리자: 상태 · 새로고침 · 메뉴(신청 수) — 진단·사용자는 메뉴 안', async () => {
    renderAs(OWNER)
    const menuButton = await screen.findByRole('button', { name: '메뉴 — 가입 신청 2건' })
    expect(menuButton).toHaveTextContent('2')
    expect(headerButtons()).toEqual(['전체 새로고침', '메뉴 — 가입 신청 2건'])
    expect(document.querySelector('.status-pill')).not.toBeNull()

    await userEvent.click(menuButton)
    expect(menuButtons()).toEqual(['알림 설정', 'AI 키 설정', '화면 설정', '진단', '사용자2', '나가기'])
    expect(within(screen.getByRole('button', { name: /사용자/ })).getByLabelText('가입 신청 2건')).toBeInTheDocument()
  })

  it('손님: 로그인 · 메뉴(화면 설정만) — 나가기·관리자 도구는 없다', async () => {
    renderAs(GUEST)
    await screen.findByRole('button', { name: '로그인' })
    expect(headerButtons()).toEqual(['로그인', '메뉴'])
    await openMenu()
    expect(menuButtons()).toEqual(['화면 설정'])
  })

  it('폰을 눕혀 넓어지면 PC 배치로 바뀐다', async () => {
    const phone = pretendPhone()
    renderAs(FRIEND)
    await screen.findByRole('button', { name: '메뉴' })
    phone.setNarrow(false)
    expect(screen.getByRole('button', { name: '나가기' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '메뉴' })).not.toBeInTheDocument()
  })
})

describe('메뉴 항목', () => {
  it('누르면 메뉴를 닫고 그 일을 한다 — AI 키 팝업', async () => {
    renderAs(FRIEND)
    await openMenu()
    await userEvent.click(screen.getByRole('button', { name: 'AI 키 설정' }))
    expect(screen.queryByRole('group', { name: '메뉴' })).not.toBeInTheDocument()
    // 팝업 코드는 누를 때 받는다(8-5) — 받는 동안의 틀이 아니라 진짜 팝업이 뜨는지 본다
    expect(await screen.findByRole('dialog', { name: 'AI 키 설정' })).not.toHaveAttribute('aria-busy')
    expect(screen.getByRole('button', { name: '메뉴' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('화면 설정 — 메뉴를 닫고 팝업을 연다', async () => {
    renderAs(FRIEND)
    await openMenu()
    await userEvent.click(screen.getByRole('button', { name: '화면 설정' }))
    expect(screen.queryByRole('group', { name: '메뉴' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: '화면 설정' })).toBeInTheDocument()
  })

  it('탈퇴는 한 번 더 묻는다', async () => {
    const withdraw = vi.spyOn(api, 'withdraw').mockResolvedValue(undefined)
    renderAs(FRIEND)
    await openMenu()
    await userEvent.click(screen.getByRole('button', { name: '탈퇴' }))
    expect(screen.getByRole('alertdialog', { name: '탈퇴할까요?' })).toBeInTheDocument()
    expect(withdraw).not.toHaveBeenCalled()
  })
})

describe('메뉴 닫기', () => {
  it('다시 누르면 닫힌다', async () => {
    renderAs(FRIEND)
    await openMenu()
    await openMenu()
    expect(screen.queryByRole('group', { name: '메뉴' })).not.toBeInTheDocument()
  })

  it('바깥을 누르면 닫힌다', async () => {
    renderAs(FRIEND)
    await openMenu()
    await userEvent.click(screen.getByTestId('where'))
    expect(screen.queryByRole('group', { name: '메뉴' })).not.toBeInTheDocument()
  })

  it('안쪽(누구로 들어왔는지)을 눌러도 닫히지 않는다', async () => {
    renderAs(FRIEND)
    await openMenu()
    await userEvent.click(within(screen.getByRole('group', { name: '메뉴' })).getByText('친구'))
    expect(screen.getByRole('group', { name: '메뉴' })).toBeInTheDocument()
  })

  it('Esc 로 닫고, 초점은 메뉴 버튼으로 돌아온다', async () => {
    renderAs(FRIEND)
    await openMenu()
    // 열면 첫 항목에서 시작한다
    expect(screen.getByRole('button', { name: '알림 설정' })).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('group', { name: '메뉴' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '메뉴' })).toHaveFocus()
  })

  it('뒤로가기는 메뉴만 닫는다 — 보던 화면은 그대로, 한 번 더 누르면 앞 화면', async () => {
    renderAs(FRIEND, BrowserRouter)
    await userEvent.click(await screen.findByRole('link', { name: '리밸런싱으로' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/rebalance')

    await openMenu()
    await back()
    expect(screen.queryByRole('group', { name: '메뉴' })).not.toBeInTheDocument()
    expect(screen.getByTestId('where')).toHaveTextContent('/rebalance')

    await back()
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/$/)
  })

  it('메뉴에서 연 팝업은 뒤로가기 한 번에 닫히고, 헛도는 칸이 남지 않는다', async () => {
    renderAs(FRIEND, BrowserRouter)
    await userEvent.click(await screen.findByRole('link', { name: '리밸런싱으로' }))
    await openMenu()
    await userEvent.click(screen.getByRole('button', { name: 'AI 키 설정' }))
    expect(screen.getByRole('dialog', { name: 'AI 키 설정' })).toBeInTheDocument()

    await back()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByTestId('where')).toHaveTextContent('/rebalance')

    await back()
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^\/$/))
  })
})
