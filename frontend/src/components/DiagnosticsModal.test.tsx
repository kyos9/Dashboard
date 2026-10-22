import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../api/client'
import type { BackupStatus, LogsResponse, RecordsStatus, SignalRulesStatus, SlowRequestsResponse } from '../types'
import { BackupLines, DiagnosticsModal, RecordsLine, summarize } from './DiagnosticsModal'
import { whenText } from '../lib/diagTime'

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
    expect(screen.getByText('서버 로그: 아직 없음')).toBeInTheDocument()
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
    expect(summarize(logs())).toBe('서버 로그: 오류 1건 · 경고 1건')
  })

  it('세는 것은 화면에 보이는 목록이 아니라 읽어들인 구간 전체다', () => {
    // entries는 limit에 걸려 잘릴 수 있다. counts가 실제 건수다.
    expect(summarize(logs({ entries: [], counts: { WARNING: 5, ERROR: 2 } }))).toBe(
      '서버 로그: 오류 2건 · 경고 5건',
    )
  })

  it('깨끗하면 깨끗하다고 한다', () => {
    expect(summarize(logs({ counts: { INFO: 9 } }))).toBe('서버 로그: 최근 경고·오류 없음')
  })

  it('백업 칸에 경고가 있으면 끝에 붙인다 — 로그가 깨끗해도 (0.45.1 C1)', () => {
    expect(summarize(logs({ counts: { INFO: 9 } }), true)).toBe('서버 로그: 최근 경고·오류 없음 · 백업 확인 필요 — 아래 백업 칸')
    expect(summarize(null, true)).toBe('백업 확인 필요 — 아래 백업 칸')
    expect(summarize(null)).toBe('')
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
    // 다시 계산 시각은 시간대 없는 UTC — 보는 사람의 시간대로 (0.45.2 B5, 전에는 UTC 숫자를 그대로 보여 9시간 어긋났다)
    expect(section).toHaveTextContent(`마지막 다시 계산 ${whenText(Date.UTC(2026, 9, 14, 3, 0))} (`)
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
    expect(screen.getByText('평가금액 기록: 마지막 2026-10-16 · 그날 3명(보유·현금이 있는 사람만) · 지금까지 41줄(사람마다 하루 한 줄)')).toBeTruthy()
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

describe('맨 위 요약과 백업 경고 (0.45.1 C1)', () => {
  const clean = () => logs({ entries: [], counts: { INFO: 3 } })
  const records = (backup: BackupStatus): RecordsStatus => ({
    value_record: { enabled: true, last_date: null, users: 0, rows: 0 },
    backup,
  })
  const ok: BackupStatus = { count: 3, keep: 7, last_at: new Date().toISOString(), last_size: 10, last_failure: null }

  it('로그는 깨끗한데 백업 칸에 경고가 있으면 요약이 그렇게 말한다', async () => {
    vi.spyOn(api, 'getLogs').mockResolvedValue(clean())
    vi.spyOn(api, 'getRecordsStatus').mockResolvedValue(records({ ...ok, last_failure: { at: new Date().toISOString(), reason: '디스크' } }))
    render(<DiagnosticsModal onClose={() => {}} />)

    // 꼬리만 경고 모양 — 같은 작은 회색 글이라 눈에 띄지 않았다 (0.45.2 B1)
    const tail = await screen.findByText('백업 확인 필요 — 아래 백업 칸')
    expect(tail).toHaveClass('diag-warn')
    expect(tail.closest('.diag-summary')?.textContent).toBe('서버 로그: 최근 경고·오류 없음 · 백업 확인 필요 — 아래 백업 칸')
  })

  it('밖에 꺼낸 지 10일이 지나도 — 경고 줄과 같은 판정', async () => {
    const old = new Date(Date.now() - 11 * 86400_000).toISOString()
    vi.spyOn(api, 'getLogs').mockResolvedValue(clean())
    vi.spyOn(api, 'getRecordsStatus').mockResolvedValue(records({ ...ok, offsite: { last_at: old } }))
    render(<DiagnosticsModal onClose={() => {}} />)

    // 꼬리만 경고 모양 — 같은 작은 회색 글이라 눈에 띄지 않았다 (0.45.2 B1)
    const tail = await screen.findByText('백업 확인 필요 — 아래 백업 칸')
    expect(tail).toHaveClass('diag-warn')
    expect(tail.closest('.diag-summary')?.textContent).toBe('서버 로그: 최근 경고·오류 없음 · 백업 확인 필요 — 아래 백업 칸')
    expect(screen.getByText(/11일 동안 밖에 꺼내지 않았습니다/)).toBeInTheDocument()
  })

  it('백업이 정상이거나 옛 서버(백업 칸 없음)면 붙지 않는다', async () => {
    vi.spyOn(api, 'getLogs').mockResolvedValue(clean())
    const spy = vi.spyOn(api, 'getRecordsStatus').mockResolvedValue(records({ ...ok, offsite: { last_at: null } }))
    const { unmount } = render(<DiagnosticsModal onClose={() => {}} />)
    await screen.findByRole('heading', { name: '평가금액 기록 · 백업' })
    expect(screen.getByText('서버 로그: 최근 경고·오류 없음')).toBeInTheDocument()
    unmount()

    spy.mockResolvedValue({ value_record: { enabled: true, last_date: null, users: 0, rows: 0 } })
    render(<DiagnosticsModal onClose={() => {}} />)
    await screen.findByRole('heading', { name: '평가금액 기록 · 백업' })
    expect(screen.getByText('서버 로그: 최근 경고·오류 없음')).toBeInTheDocument()
  })
})

describe('진단의 백업 줄 (0.44.0 D0)', () => {
  const NOW = Date.parse('2026-10-16T12:00:00Z')
  const backup = (overrides: Partial<BackupStatus> = {}): BackupStatus => ({
    count: 3, keep: 7, last_at: '2026-10-15T23:30:00+00:00', last_size: 2_621_440, last_failure: null, ...overrides,
  })

  it('마지막 시각(보는 사람의 시간대)·크기·개수 — 파일 이름은 없다', () => {
    render(<BackupLines backup={backup()} now={NOW} />)
    const line = screen.getByText(/^백업: 마지막/)
    const local = new Date('2026-10-15T23:30:00Z').toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
    expect(line.textContent).toBe(`백업: 마지막 ${local} · 2.5MB · 3개 보관(최대 7개)`)
    expect(screen.queryByRole('note')).toBeNull()
  })

  it('하나도 없으면 그렇다고, 하루 넘게 새 것이 없으면 경고, 실패했으면 그 갈래', () => {
    const { unmount } = render(<BackupLines backup={backup({ count: 0, last_at: null, last_size: null })} now={NOW} />)
    expect(screen.getByText('백업: 아직 없습니다 — 매일 하나씩 서버 안에 뜹니다.')).toBeTruthy()
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

  it('업그레이드 직전 백업은 따로 한 줄 — 매일 백업의 "마지막"·멈춤 경고를 가리지 않는다', () => {
    render(
      <BackupLines
        backup={backup({ last_at: '2026-10-13T23:30:00+00:00', count: 2, premigrate: { count: 1, last_at: '2026-10-16T00:30:00+00:00' } })}
        now={NOW}
      />,
    )
    expect(screen.getByRole('note').textContent).toBe('하루 넘게 새 백업이 없습니다 — 서버 로그를 보세요.')
    // 그 시각은 업그레이드 백업의 것 — 매일 백업 시각이 들어가면 틀린다 (D0 두 번째 검토 F1)
    const upgradeAt = new Date('2026-10-16T00:30:00Z').toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
    expect(screen.getByText(/^업그레이드 직전 백업/).textContent).toBe(`업그레이드 직전 백업 1개 · 마지막 ${upgradeAt} (위 개수에 들어 있습니다)`)
  })

  it('멈춤과 실패가 같이면 두 줄 다', () => {
    render(
      <BackupLines
        backup={backup({ last_at: '2026-10-13T23:30:00+00:00', last_failure: { at: '2026-10-16T08:30:00+00:00', reason: '디스크가 찼습니다' } })}
        now={NOW}
      />,
    )
    const notes = screen.getAllByRole('note').map((n) => n.textContent)
    expect(notes).toHaveLength(2)
    expect(notes[0]).toBe('하루 넘게 새 백업이 없습니다 — 서버 로그를 보세요.')
    expect(notes[1]).toMatch(/— 디스크가 찼습니다$/)
  })

  it('시각은 보는 사람의 시간대로 — 한국이면 UTC 23:30 이 다음 날 08:30 (D0 검토: 테스트가 UTC 라 못 잡았다)', () => {
    vi.stubEnv('TZ', 'Asia/Seoul')
    try {
      render(<BackupLines backup={backup({ last_at: '2026-10-15T23:30:00+00:00' })} now={NOW} />)
      expect(screen.getByText(/^백업: 마지막/).textContent).toMatch(/^백업: 마지막 10월 16일 08:30 ·/)
    } finally {
      vi.unstubAllEnvs()
    }
  })
})

describe('진단의 백업 줄 — 밖에 꺼낸 것 (0.45.0 A)', () => {
  const NOW = Date.parse('2026-10-20T12:00:00Z')
  const backup = (offsite: BackupStatus['offsite']): BackupStatus => ({
    count: 3, keep: 7, last_at: '2026-10-19T23:30:00+00:00', last_size: 2_621_440, last_failure: null, offsite,
  })
  const local = (iso: string) =>
    new Date(iso).toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })

  it('꺼낸 적이 없으면 그렇다고 — 경고는 아니다', () => {
    render(<BackupLines backup={backup({ last_at: null })} now={NOW} />)
    expect(screen.getByText(/^밖에 꺼낸 기록이 없습니다/).textContent).toBe(
      '밖에 꺼낸 기록이 없습니다 — 서버가 사라지면 이 백업도 같이 사라집니다. 내 PC 로 가져오는 법은 PC 의 Dashboard 폴더 DEPLOY.md 10-0.',
    )
    expect(screen.queryByRole('note')).toBeNull()
  })

  it('꺼냈으면 그 시각(관리자 PC), 10일 넘으면 경고', () => {
    const { unmount } = render(<BackupLines backup={backup({ last_at: '2026-10-13T09:00:00+00:00' })} now={NOW} />)
    expect(screen.getByText(/^밖에 꺼낸 것/).textContent).toBe(`밖에 꺼낸 것: 마지막 ${local('2026-10-13T09:00:00+00:00')} (관리자 PC)`)
    expect(screen.queryByRole('note')).toBeNull()
    unmount()

    // 10일이 지나기 전에는 경고하지 않고, 지난 순간부터 — 서버의 ⋯ 점과 같은 경계 (A 검토: 10.5일, 0.45.2 B3 전에는 30일)
    const { unmount: u2 } = render(<BackupLines backup={backup({ last_at: '2026-10-10T13:00:00+00:00' })} now={NOW} />)
    expect(screen.queryByRole('note')).toBeNull()
    u2()
    const { unmount: u3 } = render(<BackupLines backup={backup({ last_at: '2026-10-10T00:00:00+00:00' })} now={NOW} />)
    expect(screen.getByRole('note').textContent).toBe('10일 동안 밖에 꺼내지 않았습니다 — PC 에서 server-backup-pull.bat 을 실행하세요.')
    u3()
    render(<BackupLines backup={backup({ last_at: '2026-10-09T11:00:00+00:00' })} now={NOW} />)
    expect(screen.getByRole('note').textContent).toBe('11일 동안 밖에 꺼내지 않았습니다 — PC 에서 server-backup-pull.bat 을 실행하세요.')
  })

  it('옛 서버(칸 없음)면 그 줄이 없다', () => {
    render(<BackupLines backup={backup(undefined)} now={NOW} />)
    expect(screen.queryByText(/밖에 꺼낸/)).toBeNull()
  })
})

describe('한 창 안의 시각 (0.45.2 B5)', () => {
  it('로그 줄은 서버가 붙인 시간대로 바꿔 다른 줄과 같은 꼴(초까지), 옛 서버면 글자 그대로', async () => {
    const base = logs()
    const spy = vi.spyOn(api, 'getLogs').mockResolvedValue({
      ...base,
      entries: [{ ...base.entries[0], at: '2026-09-17T03:00:03+00:00' }, base.entries[1]],
    })
    const { unmount } = render(<DiagnosticsModal onClose={() => {}} />)
    await screen.findByText(/시세가 비었습니다/)
    const times = () => Array.from(document.querySelectorAll('.diag-time')).map((el) => el.textContent)
    expect(times()).toEqual([whenText(Date.UTC(2026, 8, 17, 3, 0, 3), { seconds: true }), '2026-09-17 03:00:02'])
    unmount()

    spy.mockResolvedValue(logs())
    render(<DiagnosticsModal onClose={() => {}} />)
    await screen.findByText(/시세가 비었습니다/)
    expect(times()).toEqual(['2026-09-17 03:00:03', '2026-09-17 03:00:02'])
  })

  it('느린 요청에 시간대가 붙어 오면 보는 사람의 시간대로', async () => {
    vi.spyOn(api, 'getLogs').mockResolvedValue(logs())
    vi.spyOn(api, 'getSlowRequests').mockResolvedValue({
      threshold_ms: 1000,
      since: '2026-09-28T00:00:00Z',
      items: [{ method: 'GET', route: '/api/dashboard', count: 1, max_ms: 1450, last_ms: 1450, last_status: 200, last_at: '2026-09-28T09:30:00+09:00' }],
    })
    render(<DiagnosticsModal onClose={() => {}} />)
    const section = await screen.findByRole('region', { name: /느린 요청/ })
    expect(section).toHaveTextContent(`서버를 켠 ${whenText(Date.UTC(2026, 8, 28, 0, 0))} 뒤로`)
    expect(section).toHaveTextContent(`(${whenText(Date.UTC(2026, 8, 28, 0, 30))})`)
  })
})
