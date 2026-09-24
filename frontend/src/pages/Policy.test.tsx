import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { api } from '../api/client'
import { AuthGate } from '../components/AuthGate'
import { GuestNotice, LoginPrompt, PendingPrompt } from '../components/LoginPrompt'
import type { AuthStatus } from '../types'

/** 개인정보처리방침·이용약관과 문의처 (ROADMAP 4-4b). */

function guest(overrides: Partial<AuthStatus> = {}): AuthStatus {
  return { locked: true, authenticated: false, mode: 'google', user: null, config_problem: null, ...overrides }
}

function mock(status: AuthStatus) {
  vi.spyOn(api, 'getHealth').mockResolvedValue({ status: 'ok', version: '0.22.1' })
  vi.spyOn(api, 'getAuthStatus').mockResolvedValue(status)
}

function inGate(node: React.ReactNode) {
  return render(
    <MemoryRouter>
      <AuthGate>{node}</AuthGate>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

afterEach(() => {
  window.history.replaceState(null, '', '/')
})

describe('방침 화면', () => {
  it('로그인 전에도 열린다 — 구글 동의 화면이 이 주소를 가리킨다', async () => {
    mock(guest({ contact: 'help@example.org' }))
    window.history.replaceState(null, '', '/privacy')
    render(<App />)

    const page = await screen.findByRole('article')
    expect(within(page).getByRole('heading', { name: '개인정보처리방침 · 이용약관' })).toBeInTheDocument()
    expect(within(page).getByRole('heading', { name: '이용약관' })).toBeInTheDocument()
    // 로그인을 권하는 안내로 바뀌지 않는다
    expect(screen.queryByRole('button', { name: '구글 계정으로 로그인' })).toBeNull()
    expect(within(page).getAllByText('help@example.org').length).toBeGreaterThan(0)
  })

  it('모든 화면 아래에 방침 링크가 있다', async () => {
    mock(guest())
    vi.spyOn(api, 'getMacroPinned').mockResolvedValue({ codes: [], items: [] } as never)
    render(<App />)
    const link = await screen.findByRole('link', { name: '개인정보처리방침 · 이용약관' })
    expect(link).toHaveAttribute('href', '/privacy')
  })

  it('문의처를 적지 않았으면 "관리자에게 문의"라고만 쓴다 — 주인 이메일을 대신 꺼내지 않는다', async () => {
    mock(guest())
    window.history.replaceState(null, '', '/privacy')
    render(<App />)
    const page = await screen.findByRole('article')
    expect(within(page).getAllByText(/관리자에게 문의하세요\./).length).toBeGreaterThan(0)
    expect(within(page).queryByText(/문의하세요:/)).toBeNull()
  })
})

describe('문의처와 동의 안내', () => {
  it('로그인 안내 아래에 방침 링크와 "참고용"을 적는다', async () => {
    mock(guest())
    inGate(<LoginPrompt title="로그인하면 내 포트폴리오를 볼 수 있습니다" />)
    const link = await screen.findByRole('link', { name: '개인정보처리방침·이용약관' })
    expect(link).toHaveAttribute('href', '/privacy')
    expect(screen.getByText(/투자 권유가 아닙니다/)).toBeInTheDocument()
  })

  it('거절된 사람의 안내에 문의처를 붙인다', async () => {
    window.history.replaceState(null, '', '/?login_error=rejected')
    mock(guest({ contact: '오픈채팅 open.kakao.com/o/abc' }))
    inGate(<GuestNotice />)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('문의: 오픈채팅 open.kakao.com/o/abc')
  })

  it('승인을 기다리는 사람에게도 문의처를 보여준다', async () => {
    mock(guest({ contact: 'help@example.org', user: { email: 'new@example.com', name: null, is_owner: false, status: 'pending' } }))
    inGate(<PendingPrompt />)
    expect(await screen.findByText('문의: help@example.org')).toBeInTheDocument()
  })

  it('문의처가 없으면 문의 줄을 그리지 않는다', async () => {
    mock(guest({ user: { email: 'new@example.com', name: null, is_owner: false, status: 'pending' } }))
    inGate(<PendingPrompt />)
    await screen.findByRole('heading', { name: '가입 신청을 받았습니다' })
    expect(screen.queryByText(/문의:/)).toBeNull()
  })
})
