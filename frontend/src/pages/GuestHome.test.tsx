import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../api/client'
import { AppStateProvider } from '../AppState'
import { AuthGate } from '../components/AuthGate'
import type { AuthStatus } from '../types'
import { GuestHome } from './GuestHome'

const GUEST: AuthStatus = { locked: true, authenticated: false, mode: 'google', user: null, config_problem: null }

function renderAs(status: AuthStatus) {
  vi.spyOn(api, 'getAuthStatus').mockResolvedValue(status)
  vi.spyOn(api, 'getMacroPinned').mockResolvedValue({
    codes: ['VIX'],
    series: [
      {
        code: 'VIX', name: 'VIX', note: '변동성 지수, 시장의 공포', unit: 'level', transform: 'none', transform_label: null,
        frequency: 'daily', as_of: '2026-11-19', value: 21, previous: 21, change: 0, released_at: null, source: 'dev',
        zone: null, forecastable: false, forecast: null, pending_forecast: null, stale: false,
        last_checked_at: null, last_ok_at: null, last_error: null,
      },
    ],
    badges: [],
  })
  return render(
    <MemoryRouter>
      <AuthGate>
        <AppStateProvider>
          <GuestHome />
        </AppStateProvider>
      </AuthGate>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('손님 첫 화면 (목업 15 ③ 나 — 매크로 목록 먼저)', () => {
  it('매크로 줄과 "모두 보기"가 먼저, 아래에 로그인 안내', async () => {
    renderAs(GUEST)

    const macro = await screen.findByRole('heading', { name: '오늘 매크로' })
    const login = await screen.findByRole('heading', { name: '로그인하면 내 포트폴리오를 볼 수 있습니다' })
    // 문서 순서: 매크로가 위
    expect(macro.compareDocumentPosition(login) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByRole('link', { name: '매크로 지표 모두 보기' })).toHaveAttribute('href', '/macro')
    expect(screen.getByText('담은 종목의 매수, 매도 시그널과 리밸런싱을 봅니다.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '구글 계정으로 로그인' })).toBeInTheDocument()
  })

  it('기능 소개 목록과 "로그인 없이도 매크로" 안내는 없다 — 매크로가 바로 위에 보인다', async () => {
    renderAs(GUEST)

    await screen.findByRole('heading', { name: '로그인하면 내 포트폴리오를 볼 수 있습니다' })
    expect(document.querySelector('.guest-features')).toBeNull()
    expect(screen.queryByText(/로그인 없이도/)).toBeNull()
    expect(screen.getByText('계정마다 자기 종목이 따로 저장됩니다.')).toBeInTheDocument()
  })

  it('승인 대기인 사람도 매크로 목록 아래에 "가입 신청을 받았습니다"', async () => {
    renderAs({ ...GUEST, authenticated: true, user: { email: 'p@x.y', name: null, is_owner: false, status: 'pending' } })

    expect(await screen.findByRole('heading', { name: '가입 신청을 받았습니다' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: '오늘 매크로' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '구글 계정으로 로그인' })).toBeNull()
  })
})
