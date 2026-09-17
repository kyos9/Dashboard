import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, UNAUTHORIZED_EVENT, api } from '../api/client'
import { AuthGate } from './AuthGate'

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
