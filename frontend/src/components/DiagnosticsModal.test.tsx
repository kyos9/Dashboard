import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../api/client'
import type { LogsResponse } from '../types'
import { DiagnosticsModal, summarize } from './DiagnosticsModal'

/**
 * 이 화면은 "문제가 났을 때 여는 곳"이다. 그래서 확인할 것은 예쁘냐가 아니라
 * **원인이 보이느냐**다 — 오류가 위에 오고, 트레이스백이 잘리지 않고, 로그가
 * 아직 없을 때도 화면이 깨지지 않아야 한다.
 */

function logs(overrides: Partial<LogsResponse> = {}): LogsResponse {
  return {
    available: true,
    path: '/home/user/Dashboard/backend/logs/app.log',
    size_bytes: 2048,
    modified_at: '2026-09-17T03:00:04',
    level: 'warning',
    entries: [
      {
        time: '2026-09-17 03:00:03',
        level: 'ERROR',
        logger: 'app.services.pipeline',
        message: '005930.KS 갱신 실패\nValueError: 시세가 비었습니다',
      },
      {
        time: '2026-09-17 03:00:02',
        level: 'WARNING',
        logger: 'app.services.providers',
        message: 'VOO: [yahoo] CONNECT tunnel failed, 403',
      },
    ],
    counts: { INFO: 12, WARNING: 1, ERROR: 1 },
    ...overrides,
  }
}

beforeEach(() => vi.restoreAllMocks())

describe('진단', () => {
  it('경고·오류만 먼저 보여준다', async () => {
    const spy = vi.spyOn(api, 'getLogs').mockResolvedValue(logs())
    render(<DiagnosticsModal onClose={() => {}} />)

    await screen.findByText(/시세가 비었습니다/)
    expect(spy).toHaveBeenCalledWith('warning')
  })

  it('트레이스백까지 그대로 보여준다', async () => {
    // 원인이 적힌 줄이 잘리면 이 화면을 여는 의미가 없다
    vi.spyOn(api, 'getLogs').mockResolvedValue(logs())
    render(<DiagnosticsModal onClose={() => {}} />)

    const block = await screen.findByText(/005930\.KS 갱신 실패/)
    expect(block.textContent).toContain('ValueError: 시세가 비었습니다')
  })

  it('전체를 누르면 전체로 다시 받아온다', async () => {
    const spy = vi.spyOn(api, 'getLogs').mockResolvedValue(logs())
    render(<DiagnosticsModal onClose={() => {}} />)
    await screen.findByText(/시세가 비었습니다/)

    await userEvent.click(screen.getByRole('button', { name: '전체' }))
    await waitFor(() => expect(spy).toHaveBeenCalledWith('all'))
  })

  it('로그가 아직 없어도 화면이 깨지지 않는다', async () => {
    vi.spyOn(api, 'getLogs').mockResolvedValue(
      logs({ available: false, entries: [], counts: {}, size_bytes: 0 }),
    )
    render(<DiagnosticsModal onClose={() => {}} />)

    expect(await screen.findByText(/서버를 켜고 잠시 쓰면/)).toBeInTheDocument()
    expect(screen.getByText(/아직 기록된 로그가 없습니다/)).toBeInTheDocument()
  })

  it('경고가 하나도 없으면 없다고 말해준다', async () => {
    // 빈 화면만 뜨면 "안 불러와진 건가?"를 의심하게 된다
    vi.spyOn(api, 'getLogs').mockResolvedValue(logs({ entries: [], counts: { INFO: 30 } }))
    render(<DiagnosticsModal onClose={() => {}} />)

    expect(await screen.findByText(/걸러낼 것이 없습니다/)).toBeInTheDocument()
  })

  it('로그 파일을 받는 링크를 둔다', async () => {
    vi.spyOn(api, 'getLogs').mockResolvedValue(logs())
    render(<DiagnosticsModal onClose={() => {}} />)

    const link = await screen.findByRole('link', { name: '로그 파일 받기' })
    expect(link).toHaveAttribute('href', '/api/logs/download')
    expect(link).toHaveAttribute('download')
  })

  it('Esc로 닫는다', async () => {
    vi.spyOn(api, 'getLogs').mockResolvedValue(logs())
    const onClose = vi.fn()
    render(<DiagnosticsModal onClose={onClose} />)
    await screen.findByText(/시세가 비었습니다/)

    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })
})

describe('요약 문구', () => {
  it('건수를 세어 한 줄로 알려준다', () => {
    expect(summarize(logs())).toBe('최근 기록에 오류 1건 · 경고 1건')
  })

  it('세는 것은 화면에 보이는 목록이 아니라 읽어들인 구간 전체다', () => {
    // entries는 limit에 걸려 잘릴 수 있다. counts가 실제 건수다.
    expect(summarize(logs({ entries: [], counts: { WARNING: 5, ERROR: 2 } }))).toBe(
      '최근 기록에 오류 2건 · 경고 5건',
    )
  })

  it('깨끗하면 깨끗하다고 한다', () => {
    expect(summarize(logs({ counts: { INFO: 9 } }))).toBe('최근 기록에 경고·오류가 없습니다')
  })
})
