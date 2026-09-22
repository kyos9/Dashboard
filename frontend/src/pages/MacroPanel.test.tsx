import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../api/client'
import type { MacroOverview, MacroSeriesInfo } from '../types'
import { MacroPanel } from './MacroPanel'

function series(overrides: Partial<MacroSeriesInfo> & { code: string }): MacroSeriesInfo {
  return {
    name: overrides.code,
    note: null,
    unit: 'percent',
    transform: 'none',
    transform_label: null,
    frequency: 'daily',
    as_of: '2026-09-21',
    value: 4.11,
    previous: 4.05,
    change: 0.06,
    released_at: null,
    source: 'fred_api',
    stale: false,
    last_checked_at: '2026-09-21T23:00:00',
    last_ok_at: '2026-09-21T23:00:00',
    last_error: null,
    ...overrides,
  }
}

function mockMacro(overview: Partial<MacroOverview> = {}) {
  vi.spyOn(api, 'getMacro').mockResolvedValue({
    series: [series({ code: 'DGS10', name: '미 10년물 금리', note: '장기 금리의 기준' })],
    term_spread: null,
    ...overview,
  })
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('지표 카드', () => {
  it('값과 직전 대비 변화를 보여준다', async () => {
    mockMacro()
    render(<MacroPanel />)

    expect(await screen.findByText('미 10년물 금리')).toBeInTheDocument()
    expect(screen.getByText('4.11%')).toBeInTheDocument()
    // 0.06%가 아니라 0.06%p다 — 앞쪽으로 읽으면 1.5% 상승이 되어 전혀 다른 숫자가 된다
    expect(screen.getByText('+0.06%p')).toBeInTheDocument()
  })

  it('전년비로 바꾼 지표는 그렇다고 말한다', async () => {
    mockMacro({
      series: [
        series({
          code: 'CPIAUCSL',
          name: 'CPI',
          unit: 'percent',
          transform: 'yoy',
          transform_label: '전년비',
          value: 2.91,
          change: -0.12,
          frequency: 'monthly',
          released_at: '2026-09-11',
        }),
      ],
    })
    render(<MacroPanel />)

    expect(await screen.findByText('2.91%')).toBeInTheDocument()
    expect(screen.getByText('전년비')).toBeInTheDocument()
    expect(screen.getByText('−0.12%p')).toBeInTheDocument()
    expect(screen.getByText(/2026-09-11 발표/)).toBeInTheDocument()
  })

  it('못 받은 지표는 사유를 접어서 보여준다 — "값 없음"만으로는 할 일을 모른다', async () => {
    mockMacro({
      series: [
        series({
          code: 'DGS2',
          value: null,
          previous: null,
          change: null,
          as_of: null,
          stale: true,
          last_error: 'fred_api: DGS2: 요청 실패 — ReadTimeout',
        }),
      ],
    })
    render(<MacroPanel />)

    expect(await screen.findByText('받지 못했습니다')).toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.getByText(/ReadTimeout/)).toBeInTheDocument()
  })

  it('한 번도 안 받아본 것과 받았는데 막힌 것을 구분한다', async () => {
    mockMacro({
      series: [
        series({
          code: 'DGS2',
          value: null,
          change: null,
          as_of: null,
          stale: true,
          last_checked_at: null,
          last_ok_at: null,
        }),
      ],
    })
    render(<MacroPanel />)

    expect(await screen.findByText('아직 안 받음')).toBeInTheDocument()
  })

  it('공포·탐욕 지수에는 구간 이름이 붙는다', async () => {
    mockMacro({
      series: [
        series({
          code: 'FEARGREED',
          name: '공포·탐욕 지수',
          unit: 'level',
          value: 18.4,
          change: -5.1,
        }),
      ],
    })
    render(<MacroPanel />)

    expect(await screen.findByText('극단적 공포')).toBeInTheDocument()
    expect(screen.getByText('18.4')).toBeInTheDocument()
  })

  it('구간 이름은 공포·탐욕 지수에만 붙는다 — 금리 4.11은 "극단적 공포"가 아니다', async () => {
    mockMacro()
    render(<MacroPanel />)

    await screen.findByText('미 10년물 금리')
    expect(screen.queryByText(/공포|탐욕|중립/)).not.toBeInTheDocument()
  })
})

describe('장단기 금리차', () => {
  it('역전되면 역전됐다고만 말한다 (사라/팔라를 말하지 않는다)', async () => {
    mockMacro({
      term_spread: { as_of: '2026-09-21', value: -0.25, long_code: 'DGS10', short_code: 'DGS2' },
    })
    render(<MacroPanel />)

    const line = await screen.findByText(/장단기 금리차/)
    expect(line.textContent).toContain('-0.25%p')
    expect(line.parentElement!.textContent).toContain('역전돼 있습니다')
  })

  it('정상이면 정상이라고 한다', async () => {
    mockMacro({
      term_spread: { as_of: '2026-09-21', value: 0.4, long_code: 'DGS10', short_code: 'DGS2' },
    })
    render(<MacroPanel />)

    const line = await screen.findByText(/장단기 금리차/)
    expect(line.textContent).toContain('+0.40%p')
  })

  it('두 금리가 같은 날 것이 아니면 왜 없는지 말한다', async () => {
    mockMacro({ term_spread: null })
    render(<MacroPanel />)

    expect(await screen.findByText(/같은 날/)).toBeInTheDocument()
  })
})

describe('화면 전체', () => {
  it('이 숫자들이 시그널에 안 들어간다고 화면이 직접 말한다', async () => {
    mockMacro()
    render(<MacroPanel />)

    expect(
      await screen.findByText(/매수·매도 시그널 판정에\s*들어가지 않습니다/),
    ).toBeInTheDocument()
  })

  it('지표가 하나도 없으면 다음에 뭘 할지 알려준다', async () => {
    mockMacro({ series: [] })
    render(<MacroPanel />)

    expect(await screen.findByText('아직 지표가 없습니다')).toBeInTheDocument()
    expect(screen.getByText(/diagnose.py/)).toBeInTheDocument()
  })

  it('"지금 받아오기"를 누르면 받아오고 다시 읽는다', async () => {
    mockMacro()
    const refresh = vi.spyOn(api, 'refreshMacro').mockResolvedValue([])
    const user = userEvent.setup()
    render(<MacroPanel />)

    await screen.findByText('미 10년물 금리')
    await user.click(screen.getByRole('button', { name: '지금 받아오기' }))

    expect(refresh).toHaveBeenCalled()
    expect(api.getMacro).toHaveBeenCalledTimes(2)
  })

  it('불러오기가 실패해도 화면은 뜨고 이유를 보여준다', async () => {
    vi.spyOn(api, 'getMacro').mockRejectedValue(new Error('백엔드가 응답하지 않습니다'))
    render(<MacroPanel />)

    expect(await screen.findByText(/백엔드가 응답하지 않습니다/)).toBeInTheDocument()
  })

  it('이름을 누르면 차트가 뜬다', async () => {
    mockMacro()
    vi.spyOn(api, 'getMacroHistory').mockResolvedValue({
      code: 'DGS10',
      name: '미 10년물 금리',
      unit: 'percent',
      transform: 'none',
      transform_label: null,
      points: [{ as_of: '2026-09-21', value: 4.11 }],
    })
    const user = userEvent.setup()
    render(<MacroPanel />)

    await user.click(await screen.findByRole('button', { name: '미 10년물 금리' }))

    const dialog = await screen.findByRole('dialog')
    // 시세 차트는 1년으로 열지만 매크로는 5년이다 — 지금이 높은지 낮은지는
    // 2020년이 화면에 있어야 보인다
    expect(within(dialog).getByRole('button', { name: '5년' })).toHaveClass('active')
    expect(api.getMacroHistory).toHaveBeenCalledWith('DGS10', '5y')
  })
})
