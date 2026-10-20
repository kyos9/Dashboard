import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { api } from './api/client'
import { POLICY_PATH } from './lib/policy'

/** 없는 주소 (0.45.0 D2) — 예전에는 머리글·바닥글만 남고 본문이 비었다. 손님으로 본다(누구에게나 같은 길). */
beforeEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
  vi.spyOn(api, 'getHealth').mockResolvedValue({ status: 'ok', version: '0.45.0' })
  vi.spyOn(api, 'getAuthStatus').mockResolvedValue({
    locked: true,
    authenticated: false,
    mode: 'google',
    user: null,
    config_problem: null,
  })
  vi.spyOn(api, 'getMacroPinned').mockResolvedValue({ codes: [], series: [], badges: [] })
})

afterEach(() => {
  window.history.replaceState(null, '', '/')
})

describe('없는 주소', () => {
  it('"없는 화면입니다"와 첫 화면으로 가는 단추', async () => {
    window.history.replaceState(null, '', '/foo')
    render(<App />)
    expect(await screen.findByRole('heading', { name: '없는 화면입니다' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '첫 화면으로' })).toHaveAttribute('href', '/')
  })

  it('/chart 는 차트 탭(/history)으로 넘긴다', async () => {
    window.history.replaceState(null, '', '/chart')
    render(<App />)
    expect(await screen.findByText('로그인하면 담은 종목의 차트를 볼 수 있습니다')).toBeInTheDocument()
    expect(window.location.pathname).toBe('/history')
    expect(screen.queryByRole('heading', { name: '없는 화면입니다' })).not.toBeInTheDocument()
  })

  it('있는 화면은 가로채지 않는다 — 로그인 전에 여는 방침 화면', async () => {
    window.history.replaceState(null, '', POLICY_PATH)
    render(<App />)
    expect(await screen.findByRole('heading', { name: /개인정보처리방침/ })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '없는 화면입니다' })).not.toBeInTheDocument()
  })
})
