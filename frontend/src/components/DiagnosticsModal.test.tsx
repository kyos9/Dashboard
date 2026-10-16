import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../api/client'
import type { BackupStatus, LogsResponse, RecordsStatus, SignalRulesStatus, SlowRequestsResponse } from '../types'
import { BackupLines, DiagnosticsModal, RecordsLine, summarize } from './DiagnosticsModal'

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

describe('느린 요청 (ROADMAP 8-5)', () => {
  const slow = (items: SlowRequestsResponse['items']): SlowRequestsResponse => ({
    threshold_ms: 1000,
    since: '2026-09-28T09:00:00',
    items,
  })

  it('서버를 켠 뒤로 느렸던 경로를 자주 느렸던 것부터 보여준다', async () => {
    vi.spyOn(api, 'getLogs').mockResolvedValue(logs())
    vi.spyOn(api, 'getSlowRequests').mockResolvedValue(
      slow([
        { method: 'POST', route: '/api/stocks/refresh-all', count: 4, max_ms: 8200, last_ms: 3100, last_status: 200, last_at: '2026-09-28T10:12:03' },
        { method: 'GET', route: '/api/dashboard', count: 1, max_ms: 1450, last_ms: 1450, last_status: 200, last_at: '2026-09-28T09:30:00' },
      ]),
    )
    render(<DiagnosticsModal onClose={() => {}} />)

    const section = await screen.findByRole('region', { name: /느린 요청/ })
    expect(section).toHaveTextContent('1.0초 넘게 · 서버를 켠 09-28 09:00 뒤로')
    const rows = within(section).getAllByRole('listitem')
    expect(rows[0]).toHaveTextContent('POST /api/stocks/refresh-all')
    expect(rows[0]).toHaveTextContent('4번 · 가장 길게 8.2초 · 최근 3.1초 (09-28 10:12)')
    expect(rows[1]).toHaveTextContent('GET /api/dashboard')
  })

  it('없으면 "없습니다" — 칸은 남아 잘 돌고 있다는 것을 알려준다', async () => {
    vi.spyOn(api, 'getLogs').mockResolvedValue(logs())
    vi.spyOn(api, 'getSlowRequests').mockResolvedValue(slow([]))
    render(<DiagnosticsModal onClose={() => {}} />)
    const section = await screen.findByRole('region', { name: /느린 요청/ })
    expect(section).toHaveTextContent('없습니다.')
  })

  it('못 받으면(옛 서버) 칸을 그리지 않고 로그는 그대로 보여준다', async () => {
    vi.spyOn(api, 'getLogs').mockResolvedValue(logs())
    vi.spyOn(api, 'getSlowRequests').mockRejectedValue(new Error('404'))
    render(<DiagnosticsModal onClose={() => {}} />)
    await screen.findByText(/시세가 비었습니다/)
    expect(screen.queryByRole('region', { name: /느린 요청/ })).toBeNull()
    // 오류로 띄우지도 않는다 — 옛 서버에 없는 것뿐, 주인이 할 일이 없다
    expect(screen.queryByText(/404/)).toBeNull()
  })

  it('틀이 많아도 위의 10개만 — 고칠 곳은 위에 있다', async () => {
    vi.spyOn(api, 'getLogs').mockResolvedValue(logs())
    vi.spyOn(api, 'getSlowRequests').mockResolvedValue(
      slow(
        Array.from({ length: 12 }, (_, i) => ({
          method: 'GET',
          route: `/api/r${i}`,
          count: 12 - i,
          max_ms: 1200,
          last_ms: 1100,
          last_status: 200,
          last_at: null,
        })),
      ),
    )
    render(<DiagnosticsModal onClose={() => {}} />)
    const section = await screen.findByRole('region', { name: /느린 요청/ })
    const rows = within(section).getAllByRole('listitem')
    expect(rows).toHaveLength(10)
    expect(rows[9]).toHaveTextContent('/api/r9')
  })
})


describe('진단 · 시그널 기준 (0.41.0)', () => {
  const status = (overrides: Partial<SignalRulesStatus> = {}): SignalRulesStatus => ({
    version: 'faa56cf123c6edfa',
    stored_version: 'faa56cf123c6edfa',
    up_to_date: true,
    changed_on: null,
    last_recompute: {
      at: '2026-10-14T03:00:00',
      reason: 'definition_changed',
      tickers: 12,
      changed_tickers: 3,
      changed_rows: 41,
      changed_by_ticker: { NVDA: 20 },
      failed: [],
      seconds: 1.4,
    },
    ...overrides,
  })

  it('판과 마지막 다시 계산을 한 줄로', async () => {
    vi.spyOn(api, 'getLogs').mockResolvedValue(logs())
    vi.spyOn(api, 'getSlowRequests').mockRejectedValue(new Error('404'))
    vi.spyOn(api, 'getSignalRulesStatus').mockResolvedValue(status({ changed_on: '2026-10-14' }))
    render(<DiagnosticsModal onClose={() => {}} />)
    const section = (await screen.findByRole('heading', { name: /시그널 기준/ })).closest('section')!
    expect(section).toHaveTextContent('2026-10-14에 바뀜')
    expect(section).toHaveTextContent('(정의가 바뀌어서) — 12종목 중 3종목, 판정이 바뀐 날 41개 · 1.4초')
  })

  it('아직 못 맞췄거나 실패한 종목이 있으면 그렇다고', async () => {
    vi.spyOn(api, 'getLogs').mockResolvedValue(logs())
    vi.spyOn(api, 'getSlowRequests').mockRejectedValue(new Error('404'))
    const s = status({ up_to_date: false })
    s.last_recompute!.failed = ['AAPL']
    vi.spyOn(api, 'getSignalRulesStatus').mockResolvedValue(s)
    render(<DiagnosticsModal onClose={() => {}} />)
    expect(await screen.findByText(/다음에 켤 때 합니다/)).toBeInTheDocument()
    expect(screen.getByText(/실패: AAPL/)).toBeInTheDocument()
  })

  it('옛 서버(404)면 그 칸을 그리지 않는다', async () => {
    vi.spyOn(api, 'getLogs').mockResolvedValue(logs())
    vi.spyOn(api, 'getSlowRequests').mockRejectedValue(new Error('404'))
    vi.spyOn(api, 'getSignalRulesStatus').mockRejectedValue(new Error('404'))
    render(<DiagnosticsModal onClose={() => {}} />)
    await screen.findByText(/005930.KS 갱신 실패/)
    expect(screen.queryByRole('heading', { name: /시그널 기준/ })).toBeNull()
  })
})

describe('진단 — 기록 (0.44.0)', () => {
  const status = (value: Partial<RecordsStatus['value_record']>): RecordsStatus => ({
    value_record: { enabled: true, last_date: null, users: 0, rows: 0, ...value },
  })

  it('마지막 날짜·그날 사람 수·모든 줄 수만 보인다', () => {
    render(<RecordsLine status={status({ last_date: '2026-10-16', users: 3, rows: 41 })} now={0} />)
    expect(screen.getByText('평가금액 기록: 마지막 2026-10-16 · 그날 3명 · 모두 41줄')).toBeTruthy()
  })

  it('아직 없으면 언제 쌓이는지, 꺼 두었으면 꺼졌다고', () => {
    const { unmount } = render(<RecordsLine status={status({})} now={0} />)
    expect(screen.getByText(/아직 없습니다 — 매일 아침 미국 시세를 받은 뒤 남깁니다/)).toBeTruthy()
    unmount()
    render(<RecordsLine status={status({ enabled: false, last_date: '2026-10-16', rows: 5 })} now={0} />)
    expect(screen.getByText(/꺼져 있습니다/)).toBeTruthy()
    expect(screen.queryByText(/마지막 2026-10-16/)).toBeNull()
  })

  it('진단 창에 붙고, 옛 서버(없는 경로)면 그리지 않는다', async () => {
    vi.spyOn(api, 'getLogs').mockResolvedValue(logs())
    const spy = vi.spyOn(api, 'getRecordsStatus').mockResolvedValue(status({ last_date: '2026-10-16', users: 1, rows: 2 }))
    const { unmount } = render(<DiagnosticsModal onClose={() => {}} />)
    expect(await screen.findByRole('heading', { name: '평가금액 기록 · 백업' })).toBeTruthy()
    expect(spy).toHaveBeenCalled()
    unmount()

    spy.mockRejectedValue(new Error('404'))
    render(<DiagnosticsModal onClose={() => {}} />)
    await screen.findByText(/005930.KS 갱신 실패/)
    expect(screen.queryByRole('heading', { name: '평가금액 기록 · 백업' })).toBeNull()
  })
})

describe('진단의 백업 줄 (0.44.0 D0)', () => {
  const NOW = Date.parse('2026-10-16T12:00:00Z')
  const backup = (overrides: Partial<BackupStatus> = {}): BackupStatus => ({
    count: 3, keep: 7, last_at: '2026-10-15T23:30:00+00:00', last_size: 2_621_440, last_failure: null, ...overrides,
  })

  it('마지막 시각(보는 사람의 시간대)·크기·벌 수 — 파일 이름은 없다', () => {
    render(<BackupLines backup={backup()} now={NOW} />)
    const line = screen.getByText(/^백업: 마지막/)
    const local = new Date('2026-10-15T23:30:00Z').toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
    expect(line.textContent).toBe(`백업: 마지막 ${local} · 2.5MB · 3벌 보관(최대 7)`)
    expect(screen.queryByRole('note')).toBeNull()
  })

  it('하나도 없으면 그렇다고, 하루 넘게 새 것이 없으면 경고, 실패했으면 그 갈래', () => {
    const { unmount } = render(<BackupLines backup={backup({ count: 0, last_at: null, last_size: null })} now={NOW} />)
    expect(screen.getByText('백업: 아직 없습니다 — 매일 한 벌씩 서버 안에 뜹니다.')).toBeTruthy()
    unmount()

    const { unmount: u2 } = render(<BackupLines backup={backup({ last_at: '2026-10-14T23:00:00+00:00' })} now={NOW} />)
    expect(screen.getByRole('note').textContent).toBe('하루 넘게 새 백업이 없습니다 — 서버 로그를 보세요.')
    u2()
    // 36시간 안이면 경고하지 않는다
    const { unmount: u3 } = render(<BackupLines backup={backup({ last_at: '2026-10-15T00:30:00+00:00' })} now={NOW} />)
    expect(screen.queryByRole('note')).toBeNull()
    u3()

    render(<BackupLines backup={backup({ last_failure: { at: '2026-10-16T08:30:00+00:00', reason: '디스크가 찼습니다' } })} now={NOW} />)
    expect(screen.getByRole('note').textContent).toMatch(/^마지막 실패: .+ — 디스크가 찼습니다$/)
  })

  it('작은 크기는 KB·B 로', () => {
    const { unmount } = render(<BackupLines backup={backup({ last_size: 52_000 })} now={NOW} />)
    expect(screen.getByText(/· 51KB ·/)).toBeTruthy()
    unmount()
    render(<BackupLines backup={backup({ last_size: 900 })} now={NOW} />)
    expect(screen.getByText(/· 900B ·/)).toBeTruthy()
  })

  it('옛 서버(백업 칸 없음)면 평가금액 줄만', () => {
    render(<RecordsLine status={{ value_record: { enabled: true, last_date: null, users: 0, rows: 0 } }} now={0} />)
    expect(screen.queryByText(/^백업:/)).toBeNull()
    render(<RecordsLine status={{ value_record: { enabled: true, last_date: null, users: 0, rows: 0 }, backup: backup() }} now={0} />)
    expect(screen.getByText(/^백업: 마지막/)).toBeTruthy()
  })
})
