import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppStateProvider } from '../AppState'
import { ApiError, api } from '../api/client'
import type { AdminUser, AuthStatus } from '../types'
import { AppHeader } from './AppHeader'
import { AuthGate, browser } from './AuthGate'
import { RequireLogin } from './LoginPrompt'
import { UsersModal } from './UsersModal'
import { whenLabel } from '../lib/display'

/** 가입 신청 → 관리자 승인 (ROADMAP 4-4b) — 신청한 사람의 화면과 관리자의 사용자 목록. */

function person(overrides: Partial<AdminUser> & { id: number }): AdminUser {
  return {
    email: `u${overrides.id}@example.com`,
    name: null,
    status: 'active',
    is_owner: false,
    created_at: '2026-09-20T01:00:00',
    last_login_at: '2026-09-24T01:00:00',
    stock_count: 0,
    ...overrides,
  }
}

const OWNER = person({ id: 1, email: 'me@example.com', name: '나', is_owner: true, stock_count: 12 })
const WAITING = person({ id: 7, email: 'new@example.com', name: '새 사람', status: 'pending', last_login_at: null })
const FRIEND = person({ id: 3, email: 'friend@example.com', name: '친구', stock_count: 4 })

function renderApp(status: AuthStatus, body: React.ReactNode = null) {
  vi.spyOn(api, 'getHealth').mockResolvedValue({ status: 'ok', version: '0.21.0' })
  vi.spyOn(api, 'getAuthStatus').mockResolvedValue(status)
  return render(
    <MemoryRouter>
      <AuthGate>
        <AppStateProvider>
          <AppHeader />
          {body}
        </AppStateProvider>
      </AuthGate>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('승인을 기다리는 사람', () => {
  const pending: AuthStatus = {
    locked: true,
    authenticated: false,
    mode: 'google',
    user: { email: 'new@example.com', name: '새 사람', is_owner: false, status: 'pending' },
    config_problem: null,
  }

  it('내 화면 자리에 "신청을 받았습니다"를, 로그인 버튼 대신 확인 버튼을 둔다', async () => {
    const go = vi.spyOn(browser, 'go').mockImplementation(() => {})
    renderApp(pending, <RequireLogin title="로그인하면 내 종목을 볼 수 있습니다">내 종목</RequireLogin>)

    expect(await screen.findByRole('heading', { name: '가입 신청을 받았습니다' })).toBeInTheDocument()
    expect(screen.getAllByText('new@example.com').length).toBeGreaterThan(0)
    expect(screen.queryByText('내 종목')).not.toBeInTheDocument()
    // 로그인 버튼은 또 눌러도 같은 화면이라 보여주지 않는다
    expect(screen.queryByRole('button', { name: '로그인' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '구글 계정으로 로그인' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '승인됐는지 확인' }))
    expect(go).toHaveBeenCalledWith('/')
  })

  it('헤더에 승인 대기 표시와 나가기가 있고, 탈퇴·관리자 버튼은 없다', async () => {
    renderApp(pending)
    const chip = await screen.findByText('새 사람')
    expect(within(chip.closest('.account-chip') as HTMLElement).getByText('승인 대기')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '나가기' })).toBeInTheDocument()
    for (const name of ['탈퇴', '전체 새로고침', '진단', '사용자']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
    }
  })
})

describe('관리자 헤더', () => {
  it('기다리는 신청 수를 사용자 버튼에 띄운다', async () => {
    renderApp({
      locked: true, authenticated: true, mode: 'google', config_problem: null, pending_count: 2,
      user: { email: 'me@example.com', name: '나', is_owner: true, status: 'active' },
    })
    const button = await screen.findByRole('button', { name: /사용자/ })
    expect(within(button).getByLabelText('가입 신청 2건')).toHaveTextContent('2')
  })

  it('기다리는 신청이 없으면 숫자를 붙이지 않는다', async () => {
    renderApp({
      locked: true, authenticated: true, mode: 'google', config_problem: null, pending_count: 0,
      user: { email: 'me@example.com', name: '나', is_owner: true, status: 'active' },
    })
    const button = await screen.findByRole('button', { name: '사용자' })
    expect(within(button).queryByText('0')).not.toBeInTheDocument()
  })

  it('비밀번호 문(혼자 쓰는 서버)에는 사용자 버튼이 없다 — 계정이 하나다', async () => {
    renderApp({ locked: true, authenticated: true, mode: 'password' })
    await screen.findByRole('button', { name: '진단' })
    expect(screen.queryByRole('button', { name: /사용자/ })).not.toBeInTheDocument()
  })

  it('승인하면 목록과 헤더의 숫자가 같이 줄어든다', async () => {
    const status = vi.fn<() => Promise<AuthStatus>>()
    const admin: AuthStatus = {
      locked: true, authenticated: true, mode: 'google', config_problem: null, pending_count: 1,
      user: { email: 'me@example.com', name: '나', is_owner: true, status: 'active' },
    }
    status.mockResolvedValueOnce(admin).mockResolvedValue({ ...admin, pending_count: 0 })
    vi.spyOn(api, 'getHealth').mockResolvedValue({ status: 'ok', version: '0.21.0' })
    vi.spyOn(api, 'getAuthStatus').mockImplementation(status)
    vi.spyOn(api, 'listUsers').mockResolvedValue([WAITING, OWNER])
    vi.spyOn(api, 'setUserStatus').mockResolvedValue({ ...WAITING, status: 'active' })
    render(
      <MemoryRouter>
        <AuthGate>
          <AppStateProvider>
            <AppHeader />
          </AppStateProvider>
        </AuthGate>
      </MemoryRouter>,
    )

    await userEvent.click(await screen.findByRole('button', { name: /사용자/ }))
    const row = await screen.findByTestId('user-7')
    await userEvent.click(within(row).getByRole('button', { name: '승인' }))

    expect(api.setUserStatus).toHaveBeenCalledWith(7, 'active')
    await waitFor(() => expect(within(row).getByText('사용 중')).toBeInTheDocument())
    await waitFor(() =>
      expect(within(screen.getByRole('button', { name: '사용자' })).queryByText('1')).not.toBeInTheDocument(),
    )
  })
})

describe('사용자 목록', () => {
  function open(users: AdminUser[]) {
    vi.spyOn(api, 'listUsers').mockResolvedValue(users)
    const onChanged = vi.fn()
    const onClose = vi.fn()
    render(<UsersModal onClose={onClose} onChanged={onChanged} />)
    return { onChanged, onClose }
  }

  it('상태마다 할 수 있는 것만 — 관리자 줄에는 버튼이 없다', async () => {
    open([
      WAITING,
      FRIEND,
      person({ id: 4, name: '거절된 사람', status: 'rejected' }),
      person({ id: 5, name: '차단된 사람', status: 'blocked' }),
      OWNER,
    ])
    const buttons = async (id: number) =>
      within(await screen.findByTestId(`user-${id}`))
        .queryAllByRole('button')
        .map((b) => b.textContent)

    expect(await buttons(7)).toEqual(['승인', '거절'])
    expect(await buttons(3)).toEqual(['차단'])
    expect(await buttons(4)).toEqual(['승인'])
    expect(await buttons(5)).toEqual(['차단 풀기'])
    expect(await buttons(1)).toEqual([])
    expect(screen.getByText('가입 신청 1건이 기다리고 있습니다')).toBeInTheDocument()
    expect(within(screen.getByTestId('user-3')).getByText(/종목 4개/)).toBeInTheDocument()
  })

  it('차단은 한 번 더 묻는다 — 그 사람이 바로 로그아웃된다', async () => {
    const set = vi.spyOn(api, 'setUserStatus').mockResolvedValue({ ...FRIEND, status: 'blocked' })
    const { onChanged, onClose } = open([FRIEND, OWNER])

    await userEvent.click(within(await screen.findByTestId('user-3')).getByRole('button', { name: '차단' }))
    expect(set).not.toHaveBeenCalled()
    const dialog = screen.getByRole('alertdialog', { name: '차단할까요?' })
    await userEvent.click(within(dialog).getByRole('button', { name: '차단' }))

    expect(set).toHaveBeenCalledWith(3, 'blocked')
    await waitFor(() => expect(within(screen.getByTestId('user-3')).getByText('차단')).toBeInTheDocument())
    expect(onChanged).toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled() // 확인 창을 닫아도 목록은 그대로
  })

  it('실패하면 사유를 보여주고 상태는 그대로 둔다', async () => {
    vi.spyOn(api, 'setUserStatus').mockRejectedValue(new ApiError(403, '관리자 계정은 바꿀 수 없습니다.', 'x'))
    open([WAITING])
    await userEvent.click(within(await screen.findByTestId('user-7')).getByRole('button', { name: '거절' }))
    expect(await screen.findByText(/관리자 계정은 바꿀 수 없습니다/)).toBeInTheDocument()
    expect(within(screen.getByTestId('user-7')).getByText('승인 대기')).toBeInTheDocument()
  })
})

describe('시각 표시', () => {
  it('서버의 UTC 시각을 보는 사람의 시계로, 없으면 대시', () => {
    // 테스트 기계는 대개 UTC 라 시간대를 안 붙여도 맞아 보인다 — 한국 시계로 고정해 본다
    vi.stubEnv('TZ', 'Asia/Seoul')
    try {
      expect(whenLabel(null)).toBe('—')
      expect(whenLabel('엉터리')).toBe('—')
      expect(whenLabel('2026-09-24T01:05:00')).toBe('2026.9.24 10:05')
      // 시간대가 이미 붙어 있으면 두 번 붙이지 않는다
      expect(whenLabel('2026-09-24T01:05:00Z')).toBe('2026.9.24 10:05')
      expect(whenLabel('2026-09-24T10:05:00+09:00')).toBe('2026.9.24 10:05')
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
