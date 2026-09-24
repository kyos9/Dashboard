import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, GOOGLE_LOGIN_URL, UNAUTHORIZED_EVENT, api } from '../api/client'
import type { AuthStatus } from '../types'
import { AuthGate, LOGIN_ERRORS, browser, useAuth } from './AuthGate'
import { GuestNotice, LoginButton } from './LoginPrompt'

function renderGate() {
  return render(
    <AuthGate>
      <p>대시보드 내용</p>
    </AuthGate>,
  )
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('개인 PC (잠그지 않은 서버)', () => {
  it('로그인 화면 없이 그대로 들어간다', async () => {
    vi.spyOn(api, 'getAuthStatus').mockResolvedValue({ locked: false, authenticated: true })
    renderGate()
    expect(await screen.findByText('대시보드 내용')).toBeInTheDocument()
  })

  it('백엔드에 닿지 않아도 화면은 연다 — 서버가 꺼진 것과 잠긴 것은 다른 문제다', async () => {
    vi.spyOn(api, 'getAuthStatus').mockRejectedValue(new Error('연결 실패'))
    renderGate()
    expect(await screen.findByText('대시보드 내용')).toBeInTheDocument()
  })
})

describe('잠긴 서버', () => {
  beforeEach(() => {
    vi.spyOn(api, 'getAuthStatus').mockResolvedValue({ locked: true, authenticated: false })
  })

  it('로그인 화면을 먼저 보여주고 내용은 숨긴다', async () => {
    renderGate()
    expect(await screen.findByLabelText('비밀번호')).toBeInTheDocument()
    expect(screen.queryByText('대시보드 내용')).not.toBeInTheDocument()
  })

  it('비밀번호가 맞으면 들어간다', async () => {
    const login = vi
      .spyOn(api, 'login')
      .mockResolvedValue({ locked: true, authenticated: true })
    renderGate()

    await userEvent.type(await screen.findByLabelText('비밀번호'), '열려라참깨')
    await userEvent.click(screen.getByRole('button', { name: '들어가기' }))

    expect(login).toHaveBeenCalledWith('열려라참깨')
    expect(await screen.findByText('대시보드 내용')).toBeInTheDocument()
  })

  it('틀리면 사유를 보여주고 그대로 머문다', async () => {
    vi.spyOn(api, 'login').mockRejectedValue(
      new ApiError(401, '비밀번호가 맞지 않습니다.', 'invalid password'),
    )
    renderGate()

    await userEvent.type(await screen.findByLabelText('비밀번호'), '틀린값')
    await userEvent.click(screen.getByRole('button', { name: '들어가기' }))

    expect(await screen.findByText('비밀번호가 맞지 않습니다.')).toBeInTheDocument()
    expect(screen.queryByText('대시보드 내용')).not.toBeInTheDocument()
  })

  it('빈 비밀번호로는 보내지 않는다', async () => {
    renderGate()
    await screen.findByLabelText('비밀번호')
    expect(screen.getByRole('button', { name: '들어가기' })).toBeDisabled()
  })
})

describe('세션 만료', () => {
  it('어느 화면에서든 401이 오면 로그인 화면으로 돌아온다', async () => {
    vi.spyOn(api, 'getAuthStatus').mockResolvedValue({ locked: true, authenticated: true })
    renderGate()
    expect(await screen.findByText('대시보드 내용')).toBeInTheDocument()

    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))

    await waitFor(() => expect(screen.getByLabelText('비밀번호')).toBeInTheDocument())
    expect(screen.queryByText('대시보드 내용')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
//  구글 로그인 (4-3)
// ---------------------------------------------------------------------------

describe('구글 로그인 서버 — 문 없이 손님으로 둘러본다', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/')
  })

  function googleStatus(extra: Partial<AuthStatus> = {}): AuthStatus {
    return { locked: true, authenticated: false, mode: 'google', user: null, config_problem: null, ...extra }
  }

  /** 화면 대신 — 지금 누구로 보이는지와, 손님일 때의 로그인 버튼·안내 */
  function Probe() {
    const { guest, isAdmin, logout } = useAuth()
    return (
      <>
        <GuestNotice />
        <p>대시보드 내용</p>
        <p>{`${guest ? '손님' : '들어옴'} / ${isAdmin ? '관리자' : '사용자'}`}</p>
        {guest ? (
          <LoginButton />
        ) : (
          <button onClick={() => void logout()}>나가기</button>
        )}
      </>
    )
  }

  function renderProbe() {
    return render(
      <AuthGate>
        <Probe />
      </AuthGate>,
    )
  }

  it('로그인 전에도 화면에 들어오고, 버튼을 누르면 구글로 간다', async () => {
    vi.spyOn(api, 'getAuthStatus').mockResolvedValue(googleStatus())
    const go = vi.spyOn(browser, 'go').mockImplementation(() => {})
    renderProbe()

    expect(await screen.findByText('대시보드 내용')).toBeInTheDocument()
    expect(screen.getByText('손님 / 사용자')).toBeInTheDocument()
    expect(screen.queryByLabelText('비밀번호')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '구글 계정으로 로그인' }))
    expect(go).toHaveBeenCalledWith(GOOGLE_LOGIN_URL)
  })

  it.each(['rejected', 'blocked'])('%s: 들어오지 못한 이유와 물어볼 곳을 알려주고, 닫을 수 있다', async (reason) => {
    window.history.replaceState(null, '', `/?login_error=${reason}`)
    vi.spyOn(api, 'getAuthStatus').mockResolvedValue(googleStatus())
    renderProbe()

    expect(await screen.findByRole('alert')).toHaveTextContent('관리자에게')
    // 주소에서는 지운다 — 새로고침할 때마다 다시 뜨면 안 된다
    expect(window.location.search).toBe('')

    await userEvent.click(screen.getByRole('button', { name: '안내 닫기' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('모르는 사유는 일반 안내로 보여준다', async () => {
    window.history.replaceState(null, '', '/?login_error=something-new')
    vi.spyOn(api, 'getAuthStatus').mockResolvedValue(googleStatus())
    renderProbe()
    expect(await screen.findByRole('alert')).toHaveTextContent(LOGIN_ERRORS.failed)
  })

  it('서버 설정이 덜 됐으면 누르기 전에 알리고 버튼을 막는다', async () => {
    vi.spyOn(api, 'getAuthStatus').mockResolvedValue(
      googleStatus({ config_problem: '.env 에 OWNER_GOOGLE_EMAIL 를 넣어주세요' }),
    )
    renderProbe()
    expect(await screen.findByRole('button', { name: '구글 계정으로 로그인' })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('OWNER_GOOGLE_EMAIL')
  })

  it('관리자(주인)로 들어와 있으면 관리자다', async () => {
    vi.spyOn(api, 'getAuthStatus').mockResolvedValue(
      googleStatus({ authenticated: true, user: { email: 'me@example.com', name: '나', is_owner: true } }),
    )
    renderProbe()
    expect(await screen.findByText('들어옴 / 관리자')).toBeInTheDocument()
  })

  it('다른 계정은 사용자다', async () => {
    vi.spyOn(api, 'getAuthStatus').mockResolvedValue(
      googleStatus({ authenticated: true, user: { email: 'a@b.c', name: null, is_owner: false } }),
    )
    renderProbe()
    expect(await screen.findByText('들어옴 / 사용자')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('세션이 끊기면 손님으로 돌아온다 — 화면은 그대로 열려 있다', async () => {
    vi.spyOn(api, 'getAuthStatus').mockResolvedValue(
      googleStatus({ authenticated: true, user: { email: 'a@b.c', name: null, is_owner: false } }),
    )
    renderProbe()
    await screen.findByText('들어옴 / 사용자')
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
    expect(await screen.findByText('손님 / 사용자')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '구글 계정으로 로그인' })).toBeInTheDocument()
  })

  it('나가면 첫 화면을 새로 연다 — 앞 사람의 종목이 화면에 남지 않게', async () => {
    vi.spyOn(api, 'getAuthStatus').mockResolvedValue(
      googleStatus({ authenticated: true, user: { email: 'a@b.c', name: null, is_owner: false } }),
    )
    vi.spyOn(api, 'logout').mockResolvedValue({ locked: true, authenticated: false })
    const go = vi.spyOn(browser, 'go').mockImplementation(() => {})
    renderProbe()

    await userEvent.click(await screen.findByRole('button', { name: '나가기' }))
    expect(go).toHaveBeenCalledWith('/')
  })
})

describe('혼자 쓰는 서버는 늘 관리자다', () => {
  function Role() {
    const { guest, isAdmin } = useAuth()
    return <p>{`${guest ? '손님' : '들어옴'} / ${isAdmin ? '관리자' : '사용자'}`}</p>
  }

  it('잠금 없는 PC', async () => {
    vi.spyOn(api, 'getAuthStatus').mockResolvedValue({ locked: false, authenticated: true, mode: 'open' })
    render(<AuthGate><Role /></AuthGate>)
    expect(await screen.findByText('들어옴 / 관리자')).toBeInTheDocument()
  })

  it('비밀번호 문', async () => {
    vi.spyOn(api, 'getAuthStatus').mockResolvedValue({ locked: true, authenticated: true, mode: 'password' })
    render(<AuthGate><Role /></AuthGate>)
    expect(await screen.findByText('들어옴 / 관리자')).toBeInTheDocument()
  })
})
