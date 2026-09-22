import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../api/client'
import { AppStateProvider } from '../AppState'
import type { MacroOverview, MacroSeriesInfo } from '../types'
import { MacroPanel } from './MacroPanel'

/** 별을 켜고 끄면 홈에 알려야 하므로 이 화면은 AppState 안에서 산다 */
function renderPanel() {
  return render(
    <MemoryRouter>
      <AppStateProvider>
        <MacroPanel />
      </AppStateProvider>
    </MemoryRouter>,
  )
}

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
    zone: null,
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
    badges: [],
    pinned: [],
    ...overview,
  })
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('지표 카드', () => {
  it('값과 직전 대비 변화를 보여준다', async () => {
    mockMacro()
    renderPanel()

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
    renderPanel()

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
    renderPanel()

    expect(await screen.findByText('받지 못했습니다')).toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.getByText(/ReadTimeout/)).toBeInTheDocument()
  })

  it('언제 받아봤는지 같이 보여준다 — 값 날짜만으로는 출처 탓인지 우리 탓인지 모른다', async () => {
    mockMacro()
    renderPanel()

    await screen.findByText('미 10년물 금리')
    // 시간대는 보는 사람의 것이라 문자열을 못 박지 않는다. 확인할 것은 "붙었는가"다.
    expect(screen.getByText(/\d+\/\d+ \d{2}:\d{2} 확인/)).toBeInTheDocument()
  })

  it('한 번도 안 받아봤으면 그렇다고 말한다', async () => {
    mockMacro({
      series: [series({ code: 'FEARGREED', value: null, as_of: null, last_checked_at: null })],
    })
    renderPanel()

    expect(await screen.findByText(/받아본 적 없음/)).toBeInTheDocument()
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
    renderPanel()

    expect(await screen.findByText('아직 안 받음')).toBeInTheDocument()
  })

  it('점수만 띄우지 않고 어느 구간인지 글자로 쓴다', async () => {
    mockMacro({
      series: [
        series({
          code: 'FEARGREED',
          name: '공포·탐욕 지수',
          unit: 'level',
          value: 33.7,
          change: -5.1,
          zone: { label: '공포', range: '25~44', extreme: false },
        }),
      ],
    })
    renderPanel()

    expect(await screen.findByText(/공포 구간/)).toBeInTheDocument()
    expect(screen.getByText('33.7')).toBeInTheDocument()
    // 범위를 같이 적어야 33.7이 왜 공포인지가 보인다
    expect(screen.getByText('25~44')).toBeInTheDocument()
  })

  it('극단이 아닌 구간은 눈에 띄는 색을 쓰지 않는다', async () => {
    mockMacro({
      series: [
        series({
          code: 'FEARGREED',
          value: 50,
          zone: { label: '중립', range: '45~55', extreme: false },
        }),
      ],
    })
    renderPanel()

    expect((await screen.findByText(/중립 구간/)).className).toContain('badge-grey')
  })

  it('극단 구간은 눈에 띄게 하되 초록·빨강은 쓰지 않는다 — 그건 사라/팔아라가 된다', async () => {
    mockMacro({
      series: [
        series({
          code: 'FEARGREED',
          value: 18.4,
          zone: { label: '극단적 공포', range: '0~24', extreme: true },
        }),
      ],
    })
    renderPanel()

    const line = await screen.findByText(/극단적 공포 구간/)
    expect(line.className).toContain('badge-amber')
    expect(line.className).not.toContain('badge-green')
    expect(line.className).not.toContain('badge-red')
  })

  it('구간이 정해져 있지 않은 지표에는 구간 줄이 안 붙는다', async () => {
    mockMacro()
    renderPanel()

    await screen.findByText('미 10년물 금리')
    expect(screen.queryByText(/구간/)).not.toBeInTheDocument()
  })
})

describe('국면 배지', () => {
  it('걸린 규칙마다 배지가 하나씩 뜨고, 왜 떴는지가 같이 붙는다', async () => {
    mockMacro({
      badges: [
        {
          key: 'inverted_curve',
          label: '장단기 금리 역전',
          detail: 'DGS10 − DGS2 -0.25%p',
          tone: 'amber',
          as_of: '2026-09-21',
        },
        {
          key: 'vix_fear',
          label: '공포 구간',
          detail: 'VIX 32.4 (기준 30 초과)',
          tone: 'amber',
          as_of: '2026-09-21',
        },
      ],
    })
    renderPanel()

    expect(await screen.findByText('장단기 금리 역전')).toBeInTheDocument()
    expect(screen.getByText('VIX 32.4 (기준 30 초과)')).toBeInTheDocument()
  })

  it('합쳐서 점수 하나로 만들지 않는다 — 배지는 따로 뜬다', async () => {
    mockMacro({
      badges: [
        { key: 'vix_fear', label: '공포 구간', detail: 'VIX 41.0', tone: 'amber', as_of: null },
        {
          key: 'fear_greed_extreme',
          label: '극단적 공포',
          detail: '공포·탐욕 지수 8점 (0~24)',
          tone: 'amber',
          as_of: null,
        },
      ],
    })
    renderPanel()

    await screen.findByText('공포 구간')
    expect(document.querySelectorAll('.regime-badge')).toHaveLength(2)
    expect(screen.queryByText(/점수|종합 매크로/)).not.toBeInTheDocument()
  })

  it('아무것도 안 걸리면 조용하다고 말한다 — 빈 자리는 "안 불러왔나"로 보인다', async () => {
    mockMacro({ badges: [] })
    renderPanel()

    expect(await screen.findByText('지금 눈에 띄는 국면은 없습니다.')).toBeInTheDocument()
  })
})

describe('홈에 올리는 ☆', () => {
  it('고른 지표는 별이 켜져 있다', async () => {
    mockMacro({ pinned: ['DGS10'] })
    renderPanel()

    expect(await screen.findByRole('button', { name: /홈 화면에 올리기/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('누르면 그 코드가 더해져 저장된다', async () => {
    mockMacro({ pinned: [] })
    const save = vi
      .spyOn(api, 'setMacroPinned')
      .mockResolvedValue({ codes: ['DGS10'], series: [], badges: [] })
    const user = userEvent.setup()
    renderPanel()

    await user.click(await screen.findByRole('button', { name: /홈 화면에 올리기/ }))

    expect(save).toHaveBeenCalledWith(['DGS10'])
  })

  it('켜져 있는 것을 누르면 빼고 저장한다', async () => {
    mockMacro({ pinned: ['DGS10'] })
    const save = vi.spyOn(api, 'setMacroPinned').mockResolvedValue({ codes: [], series: [], badges: [] })
    const user = userEvent.setup()
    renderPanel()

    await user.click(await screen.findByRole('button', { name: /홈 화면에 올리기/ }))

    // **빈 목록을 그대로 보낸다** — "다 껐다"는 선택이고, 안 보내면 기본값으로 되돌아간다
    expect(save).toHaveBeenCalledWith([])
  })

  it('장단기 금리차도 홈에 올릴 수 있다 — 계산값이지만 사용자에겐 지표 하나다', async () => {
    mockMacro({
      term_spread: { as_of: '2026-09-21', value: -0.25, long_code: 'DGS10', short_code: 'DGS2' },
      pinned: [],
    })
    const save = vi
      .spyOn(api, 'setMacroPinned')
      .mockResolvedValue({ codes: ['TERM_SPREAD'], series: [], badges: [] })
    const user = userEvent.setup()
    renderPanel()

    await user.click(await screen.findByRole('button', { name: /장단기 금리차 홈 화면에/ }))

    expect(save).toHaveBeenCalledWith(['TERM_SPREAD'])
  })

  it('저장에 실패하면 별을 원래대로 되돌린다', async () => {
    mockMacro({ pinned: [] })
    vi.spyOn(api, 'setMacroPinned').mockRejectedValue(new Error('저장하지 못했습니다'))
    const user = userEvent.setup()
    renderPanel()

    const star = await screen.findByRole('button', { name: /홈 화면에 올리기/ })
    await user.click(star)

    // 켜진 채로 두면 홈에 왜 안 뜨는지 알 수 없게 된다
    await waitFor(() => expect(star).toHaveAttribute('aria-pressed', 'false'))
    expect(screen.getByText(/저장하지 못했습니다/)).toBeInTheDocument()
  })
})

describe('장단기 금리차', () => {
  it('역전되면 역전됐다고만 말한다 (사라/팔라를 말하지 않는다)', async () => {
    mockMacro({
      term_spread: { as_of: '2026-09-21', value: -0.25, long_code: 'DGS10', short_code: 'DGS2' },
    })
    renderPanel()

    const line = await screen.findByText(/장단기 금리차/)
    expect(line.textContent).toContain('-0.25%p')
    expect(line.parentElement!.textContent).toContain('역전돼 있습니다')
  })

  it('정상이면 정상이라고 한다', async () => {
    mockMacro({
      term_spread: { as_of: '2026-09-21', value: 0.4, long_code: 'DGS10', short_code: 'DGS2' },
    })
    renderPanel()

    const line = await screen.findByText(/장단기 금리차/)
    expect(line.textContent).toContain('+0.40%p')
  })

  it('두 금리가 같은 날 것이 아니면 왜 없는지 말한다', async () => {
    mockMacro({ term_spread: null })
    renderPanel()

    expect(await screen.findByText(/같은 날/)).toBeInTheDocument()
  })
})

describe('화면 전체', () => {
  it('이 숫자들이 시그널에 안 들어간다고 화면이 직접 말한다', async () => {
    mockMacro()
    renderPanel()

    expect(
      await screen.findByText(/매수·매도 시그널 판정에\s*들어가지 않습니다/),
    ).toBeInTheDocument()
  })

  it('지표가 하나도 없으면 다음에 뭘 할지 알려준다', async () => {
    mockMacro({ series: [] })
    renderPanel()

    expect(await screen.findByText('아직 지표가 없습니다')).toBeInTheDocument()
    expect(screen.getByText(/diagnose.py/)).toBeInTheDocument()
  })

  it('"지금 받아오기"를 누르면 받아오고 다시 읽는다', async () => {
    mockMacro()
    const refresh = vi.spyOn(api, 'refreshMacro').mockResolvedValue([])
    const user = userEvent.setup()
    renderPanel()

    await screen.findByText('미 10년물 금리')
    await user.click(screen.getByRole('button', { name: '지금 받아오기' }))

    expect(refresh).toHaveBeenCalled()
    expect(api.getMacro).toHaveBeenCalledTimes(2)
  })

  it('불러오기가 실패해도 화면은 뜨고 이유를 보여준다', async () => {
    vi.spyOn(api, 'getMacro').mockRejectedValue(new Error('백엔드가 응답하지 않습니다'))
    renderPanel()

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
    renderPanel()

    await user.click(await screen.findByRole('button', { name: '미 10년물 금리' }))

    const dialog = await screen.findByRole('dialog')
    // 시세 차트는 1년으로 열지만 매크로는 5년이다 — 지금이 높은지 낮은지는
    // 2020년이 화면에 있어야 보인다
    expect(within(dialog).getByRole('button', { name: '5년' })).toHaveClass('active')
    expect(api.getMacroHistory).toHaveBeenCalledWith('DGS10', '5y')
  })
})
