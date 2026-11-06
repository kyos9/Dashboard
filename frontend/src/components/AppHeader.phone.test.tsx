/**
 * 폰 머리줄 한 줄 + 설정 탭 (디자인 4차 묶음 2 — 예전 ⋯ 메뉴는 설정 탭이 되었다).
 *
 * 지킬 것: 폰 머리줄에는 로고·상태·새로고침(관리자)·로그인(손님)만 있다. 나머지는 설정 탭에 있고,
 * 누가 들어왔는지에 따라 보이는 것이 다르다(관리자 도구가 사용자에게 새지 않는다).
 * 관리자가 볼 것(가입 신청 · 진단)은 설정 탭 아이콘에 숫자 · 점으로 — 예전 메뉴 단추의 숫자 · 점.
 */
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BrowserRouter, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppStateProvider } from '../AppState'
import { api } from '../api/client'
import { resetBackToClose } from '../lib/backToClose'
import { SettingsPage } from '../pages/SettingsPage'
import { forgetPhone, pretendPhone } from '../test/phone'
import type { AuthStatus } from '../types'
import { AppHeader } from './AppHeader'
import { AuthGate } from './AuthGate'
import { TabBar } from './TabBar'

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
          <TabBar />
          <SettingsPage />
          <Routes>
            <Route path="*" element={<Where />} />
          </Routes>
        </AppStateProvider>
      </AuthGate>
    </Router>,
  )
}

/** 머리줄에 바로 보이는 단추 이름들 */
function headerButtons() {
  const header = document.querySelector('header.app-header') as HTMLElement
  return within(header)
    .queryAllByRole('button')
    .map((b) => b.getAttribute('aria-label') ?? b.textContent)
}

/** 설정 탭의 줄 이름들 (값 · 숫자 빼고) */
function settingsRows() {
  return Array.from(document.querySelectorAll('.settings-list .settings-label')).map((el) =>
    (el.childNodes[0]?.textContent ?? '').trim(),
  )
}

function settingsTab() {
  return screen.getByRole('link', { name: /^설정/ })
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

describe('폰 머리줄은 한 줄 — 메뉴 없음', () => {
  it('사용자: 머리줄에 단추가 없다. 알림·AI 키·화면·나가기·탈퇴는 설정 탭', async () => {
    renderAs(FRIEND)
    expect(await screen.findByText('친구')).toBeInTheDocument()
    expect(headerButtons()).toEqual([])
    expect(screen.queryByRole('button', { name: /^메뉴/ })).toBeNull()
    expect(settingsRows()).toEqual(['화면', '알림', 'AI 키', '나가기', '모든 기기에서 나가기', '탈퇴', '개인정보처리방침 · 이용약관', '만든 것들 · 글꼴 · 그림'])
    // 누구로 들어왔는지 · 버전은 설정 탭에
    expect(document.querySelector('.settings-account')).toHaveTextContent('friend@example.com')
    expect(await screen.findByText('v0.31.0')).toBeInTheDocument()
  })

  it('관리자: 상태 · 새로고침. 진단 · 사용자(신청 수)는 설정 탭, 탭 아이콘에 숫자', async () => {
    renderAs(OWNER)
    expect(await screen.findByLabelText('가입 신청 2건', { selector: '.tab-badge' })).toHaveTextContent('2')
    expect(headerButtons()).toEqual(['전체 새로고침'])
    expect(document.querySelector('.status-pill')).not.toBeNull()
    expect(settingsRows()).toEqual(['화면', '알림', 'AI 키', '서버 상태', '사용자', '나가기', '모든 기기에서 나가기', '개인정보처리방침 · 이용약관', '만든 것들 · 글꼴 · 그림'])
    expect(within(screen.getByRole('button', { name: /^사용자/ })).getByLabelText('가입 신청 2건')).toBeInTheDocument()
  })

  it('관리자: 백업을 봐야 하면 설정 탭에 점, 진단 줄에 표시 (0.45.0)', async () => {
    renderAs({ ...OWNER, pending_count: 0, backup_attention: true })
    expect(await screen.findByLabelText('서버 상태를 확인하세요 — 백업', { selector: '.tab-dot' })).toBeInTheDocument()
    const diag = screen.getByRole('button', { name: /^서버 상태/ })
    expect(within(diag).getByLabelText('서버 상태를 확인하세요 — 백업')).toBeInTheDocument()
    expect(diag).toHaveAttribute('title', '서버 상태를 확인하세요 — 백업')
  })

  it('관리자: 시세 받기가 막혔으면 같은 점, 풀이에 까닭 (0.46.0 C) · 둘 다면 까닭도 둘', async () => {
    renderAs({ ...OWNER, pending_count: 0, backup_attention: true, refresh_attention: true })
    expect(await screen.findByLabelText('서버 상태를 확인하세요 — 백업 · 시세 받기', { selector: '.tab-dot' })).toBeInTheDocument()
  })

  it('관리자: 신청도 있고 백업도 봐야 하면 탭에 숫자와 점을 같이 — 숫자가 점을 가리지 않는다 (0.45.2 B4)', async () => {
    renderAs({ ...OWNER, backup_attention: true })
    expect(await screen.findByLabelText('가입 신청 2건', { selector: '.tab-badge' })).toBeInTheDocument()
    expect(screen.getByLabelText('서버 상태를 확인하세요 — 백업', { selector: '.tab-dot' })).toBeInTheDocument()
    expect(within(screen.getByRole('button', { name: /^서버 상태/ })).getByLabelText('서버 상태를 확인하세요 — 백업')).toBeInTheDocument()
  })

  it('관리자: 옛 서버(칸 없음)·문제 없음이면 점도 숫자도 없다', async () => {
    renderAs({ ...OWNER, pending_count: 0 })
    await screen.findByText('나')
    expect(settingsTab().querySelector('.tab-dot, .tab-badge')).toBeNull()
  })

  it('사용자에게는 점도 숫자도 없다 — 관리자 일이 새지 않는다', async () => {
    renderAs({ ...FRIEND, pending_count: 3, backup_attention: true })
    await screen.findByText('친구')
    expect(settingsTab().querySelector('.tab-dot, .tab-badge')).toBeNull()
  })

  it('손님: 로그인만 — 설정 탭에는 화면 · 방침 · 만든 것들', async () => {
    renderAs(GUEST)
    expect((await screen.findAllByRole('button', { name: '로그인' })).length).toBeGreaterThan(0)
    expect(headerButtons()).toEqual(['로그인'])
    expect(settingsRows()).toEqual(['화면', '개인정보처리방침 · 이용약관', '만든 것들 · 글꼴 · 그림'])
  })

  it('폰을 눕혀 넓어지면 PC 배치 — 탭은 왼쪽 메뉴로', async () => {
    const phone = pretendPhone()
    renderAs(FRIEND)
    await screen.findByText('친구')
    expect(screen.getByRole('navigation', { name: '화면' })).toHaveClass('bottom-tabs')
    phone.setNarrow(false)
    // 바뀐 배치는 다음 그리기에 온다
    expect(await screen.findByRole('navigation', { name: '화면' })).toHaveClass('side-nav')
  })
})

describe('설정 탭의 줄', () => {
  it('누르면 그 일을 한다 — AI 키 팝업', async () => {
    renderAs(FRIEND)
    await userEvent.click(await screen.findByRole('button', { name: 'AI 키' }))
    // 팝업 코드는 누를 때 받는다(8-5) — 받는 동안의 틀이 아니라 진짜 팝업이 뜨는지 본다
    expect(await screen.findByRole('dialog', { name: 'AI 키 설정' })).not.toHaveAttribute('aria-busy')
  })

  it('화면 — 지금 값이 줄에 보이고, 팝업에서 바꾸면 따라 바뀐다', async () => {
    renderAs(FRIEND)
    const row = await screen.findByRole('button', { name: /^화면/ })
    expect(row).toHaveTextContent('기기 설정 · 상승 초록')
    await userEvent.click(row)
    // 팝업 코드는 누를 때 받는다 — 받는 동안의 틀을 지나 진짜 팝업을 기다린다
    await screen.findByRole('group', { name: '상승 색' })
    const dialog = screen.getByRole('dialog', { name: '화면 설정' })
    await userEvent.click(within(within(dialog).getByRole('group', { name: '상승 색' })).getByRole('button', { name: '빨강' }))
    expect(screen.getByRole('button', { name: /^화면/ })).toHaveTextContent('상승 빨강')
  })

  it('탈퇴는 한 번 더 묻는다', async () => {
    const withdraw = vi.spyOn(api, 'withdraw').mockResolvedValue(undefined)
    renderAs(FRIEND)
    await userEvent.click(await screen.findByRole('button', { name: '탈퇴' }))
    expect(screen.getByRole('alertdialog', { name: '탈퇴할까요?' })).toBeInTheDocument()
    expect(withdraw).not.toHaveBeenCalled()
  })

  it('승인 대기에게는 "모든 기기에서 나가기"가 없다 — 서버도 401 이다', async () => {
    renderAs({ ...FRIEND, user: { ...FRIEND.user!, status: 'pending' } })
    expect(await screen.findByRole('button', { name: '나가기' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '모든 기기에서 나가기' })).toBeNull()
  })

  it('설정에서 연 팝업은 뒤로가기 한 번에 닫히고, 보던 화면은 그대로', async () => {
    renderAs(FRIEND, BrowserRouter)
    await userEvent.click(await screen.findByRole('button', { name: /^화면/ }))
    expect(await screen.findByRole('dialog', { name: '화면 설정' })).toBeInTheDocument()
    await back()
    expect(screen.queryByRole('dialog', { name: '화면 설정' })).not.toBeInTheDocument()
    expect(screen.getByTestId('where')).toHaveTextContent('/')
  })
})
