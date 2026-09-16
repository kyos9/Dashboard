import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppStateProvider } from '../AppState'
import { api } from '../api/client'
import type { RefreshResult } from '../types'
import { AppHeader } from './AppHeader'

function refreshResult(overrides: Partial<RefreshResult> & { ticker: string }): RefreshResult {
  return { ok: true, rows_upserted: 10, error: null, hint: null, ...overrides }
}

function mockHealth() {
  vi.spyOn(api, 'getHealth').mockResolvedValue({
    status: 'ok',
    version: '0.4.0 (abc1234)',
    providers: ['yahoo', 'stooq'],
    providers_by_market: { US: ['yahoo', 'stooq'], KR: ['naver', 'yahoo'] },
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
    expect(await screen.findByText('v0.4.0 (abc1234)')).toBeInTheDocument()
  })

  it('시장별 제공자 순서를 툴팁에 담는다', async () => {
    mockHealth()
    renderHeader()

    const badge = await screen.findByText('v0.4.0 (abc1234)')
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
