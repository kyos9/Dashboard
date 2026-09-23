import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppStateProvider } from '../AppState'
import { ApiError, api } from '../api/client'
import type { RefreshResult } from '../types'
import { AppHeader } from './AppHeader'
import { AuthGate } from './AuthGate'

function refreshResult(overrides: Partial<RefreshResult> & { ticker: string }): RefreshResult {
  return { ok: true, rows_upserted: 10, error: null, hint: null, ...overrides }
}

function mockHealth(extra: Record<string, unknown> = {}) {
  vi.spyOn(api, 'getHealth').mockResolvedValue({
    status: 'ok',
    version: '0.4.0',
    revision: 'abc1234',
    providers_by_market: { US: ['yahoo', 'stooq'], KR: ['naver', 'yahoo'], JP: ['yahoo', 'stooq'] },
    ...extra,
  })
}

function renderHeader() {
  return render(
    <MemoryRouter>
      <AppStateProvider>
        <AppHeader />
      </AppStateProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
})

describe('버전 표시', () => {
  it('실행 중인 백엔드 버전을 보여준다 (업데이트가 반영됐는지 확인용)', async () => {
    mockHealth()
    renderHeader()
    expect(await screen.findByText('v0.4.0')).toBeInTheDocument()
  })

  it('만든 날짜를 같이 보여준다 — 해시만으로는 언제 것인지 알 수 없다', async () => {
    mockHealth({ built_at: '2026-09-21T16:11:00Z' })
    renderHeader()

    // 시간대는 보는 사람의 것이므로 날짜 문자열을 고정하지 않는다.
    // 확인할 것은 "버전 옆에 무언가 더 붙었는가"다.
    const badge = await screen.findByText(/^v0\.4\.0 · /)
    expect(badge).toBeInTheDocument()
  })

  it('만든 날짜가 없으면 버전만 보여준다 (손으로 빌드한 경우)', async () => {
    mockHealth({ built_at: null })
    renderHeader()
    expect(await screen.findByText('v0.4.0')).toBeInTheDocument()
  })

  it('읽을 수 없는 날짜는 아예 안 붙인다 — Invalid Date 는 없는 것보다 나쁘다', async () => {
    mockHealth({ built_at: '그런 날짜 없음' })
    renderHeader()
    expect(await screen.findByText('v0.4.0')).toBeInTheDocument()
  })

  it('커밋 해시와 제공자 순서를 툴팁에 담는다', async () => {
    mockHealth()
    renderHeader()

    const badge = await screen.findByText('v0.4.0')
    expect(badge).toHaveAttribute('title', expect.stringContaining('커밋 abc1234'))
    expect(badge).toHaveAttribute('title', expect.stringContaining('국내: naver → yahoo'))
    expect(badge).toHaveAttribute('title', expect.stringContaining('해외: yahoo → stooq'))
  })

  it('백엔드가 응답하지 않아도 헤더는 뜬다', async () => {
    vi.spyOn(api, 'getHealth').mockRejectedValue(new Error('연결 실패'))
    renderHeader()

    expect(await screen.findByRole('heading', { name: /신호판/ })).toBeInTheDocument()
  })
})

describe('테마 전환', () => {
  it('기본은 다크 테마', async () => {
    mockHealth()
    renderHeader()
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'))
  })

  it('토글하면 라이트로 바뀌고 브라우저에 저장된다', async () => {
    mockHealth()
    const user = userEvent.setup()
    renderHeader()

    await user.click(screen.getByRole('button', { name: '밝은 테마로 전환' }))

    expect(document.documentElement.dataset.theme).toBe('light')
    expect(localStorage.getItem('signalboard.theme')).toBe('light')
  })

  it('저장된 테마를 기억한다', async () => {
    localStorage.setItem('signalboard.theme', 'light')
    mockHealth()
    renderHeader()

    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('light'))
  })
})

describe('전체 새로고침', () => {
  it('성공하면 갱신 시각을 보여준다', async () => {
    mockHealth()
    vi.spyOn(api, 'refreshAll').mockResolvedValue([refreshResult({ ticker: 'VOO' })])
    const user = userEvent.setup()
    renderHeader()

    await user.click(screen.getByRole('button', { name: '전체 새로고침' }))
    expect(await screen.findByText(/시세 연동 정상/)).toBeInTheDocument()
  })

  it('전 종목이 같은 이유로 실패하면 사유를 한 번만 보여준다', async () => {
    mockHealth()
    const hint = '네트워크에서 시세 서버로 나가지 못하고 있습니다.'
    vi.spyOn(api, 'refreshAll').mockResolvedValue([
      refreshResult({ ticker: 'VOO', ok: false, error: '403', hint }),
      refreshResult({ ticker: 'QQQ', ok: false, error: '403', hint }),
      refreshResult({ ticker: '005930.KS', ok: false, error: '403', hint }),
    ])
    const user = userEvent.setup()
    renderHeader()

    await user.click(screen.getByRole('button', { name: '전체 새로고침' }))

    const alert = await screen.findByText(/3개 종목 갱신 실패/)
    expect(alert.textContent).toContain('VOO, QQQ, 005930.KS')
    // 같은 안내가 세 번 반복되면 읽을 수 없다
    expect(alert.textContent!.match(new RegExp(hint, 'g'))).toHaveLength(1)
  })

  it('사유가 다르면 모두 보여준다', async () => {
    mockHealth()
    vi.spyOn(api, 'refreshAll').mockResolvedValue([
      refreshResult({ ticker: 'ZZZZ', ok: false, error: 'not found', hint: '티커 철자를 확인해주세요.' }),
      refreshResult({ ticker: 'VOO', ok: false, error: '403', hint: '방화벽을 확인해주세요.' }),
    ])
    const user = userEvent.setup()
    renderHeader()

    await user.click(screen.getByRole('button', { name: '전체 새로고침' }))

    const alert = await screen.findByText(/2개 종목 갱신 실패/)
    expect(alert.textContent).toContain('티커 철자를 확인해주세요.')
    expect(alert.textContent).toContain('방화벽을 확인해주세요.')
  })

  it('요청 자체가 실패해도 오류를 보여준다', async () => {
    mockHealth()
    vi.spyOn(api, 'refreshAll').mockRejectedValue(new Error('백엔드가 응답하지 않습니다'))
    const user = userEvent.setup()
    renderHeader()

    await user.click(screen.getByRole('button', { name: '전체 새로고침' }))
    expect(await screen.findByText(/백엔드가 응답하지 않습니다/)).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
//  계정 (구글 로그인)
// ---------------------------------------------------------------------------

describe('구글 계정', () => {
  function renderSignedIn(user: { email: string; name: string | null; is_owner: boolean }) {
    mockHealth()
    vi.spyOn(api, 'getAuthStatus').mockResolvedValue({
      locked: true, authenticated: true, mode: 'google', user, config_problem: null,
    })
    return render(
      <MemoryRouter>
        <AuthGate>
          <AppStateProvider>
            <AppHeader />
          </AppStateProvider>
        </AuthGate>
      </MemoryRouter>,
    )
  }

  it('누구로 들어와 있는지 보여준다 — 계정이 여럿인 폰에서 헷갈리지 않게', async () => {
    renderSignedIn({ email: 'friend@example.com', name: '친구', is_owner: false })
    const chip = await screen.findByText('친구')
    expect(chip.closest('.account-chip')).toHaveAttribute('title', 'friend@example.com')
  })

  it('주인에게는 탈퇴 버튼이 없다', async () => {
    renderSignedIn({ email: 'me@example.com', name: '나', is_owner: true })
    await screen.findByText('나')
    expect(screen.getByText('주인')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '탈퇴' })).not.toBeInTheDocument()
  })

  it('탈퇴는 한 번 더 묻고, 지우면 로그인 화면으로 돌아간다', async () => {
    const withdraw = vi.spyOn(api, 'withdraw').mockResolvedValue(undefined)
    renderSignedIn({ email: 'friend@example.com', name: '친구', is_owner: false })

    await userEvent.click(await screen.findByRole('button', { name: '탈퇴' }))
    expect(withdraw).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog', { name: '탈퇴할까요?' })).toBeInTheDocument()

    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '탈퇴' }))
    expect(withdraw).toHaveBeenCalledOnce()
    expect(await screen.findByRole('button', { name: '구글 계정으로 로그인' })).toBeInTheDocument()
  })

  it('탈퇴에 실패하면 창에 사유를 남기고 그대로 둔다', async () => {
    vi.spyOn(api, 'withdraw').mockRejectedValue(new ApiError(500, '서버 오류', 'boom'))
    renderSignedIn({ email: 'friend@example.com', name: '친구', is_owner: false })

    await userEvent.click(await screen.findByRole('button', { name: '탈퇴' }))
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '탈퇴' }))

    expect(await screen.findByText('서버 오류')).toBeInTheDocument()
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(screen.getByText('친구')).toBeInTheDocument()
  })
})
