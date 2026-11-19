import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../api/client'
import { AppStateProvider } from '../AppState'
import { AuthGate } from '../components/AuthGate'
import type { AuthStatus, MacroOverview, MacroSeriesInfo } from '../types'
import { MacroPanel } from './MacroPanel'
import { periodOf } from '../components/macro/period'

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
    forecastable: false,
    forecast: null,
    pending_forecast: null,
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

  it('전년비로 바꾼 지표는 그렇다고 말한다 — 꼬리표 · 어느 달 · 발표일은 풀이 한 줄 안 (목업 14 ②)', async () => {
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
    expect(screen.getByRole('listitem').querySelector('.macro-row-name small')).toHaveTextContent('전년비, 2026년 9월분, 2026-09-11 발표')
    expect(screen.getByText('−0.12%p')).toBeInTheDocument()
    // 배지가 줄 아래 따로 붙지 않는다
    expect(screen.getByRole('listitem').querySelector('.macro-row-more')).toBeNull()
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
    // 지표마다 같은 시각이면 목록 위에 한 번만 (목업 13 ④ — 카드마다 같은 두 줄이 반복됐다)
    expect(screen.getByText(/^\d+\/\d+ \d{2}:\d{2}에 받음/)).toBeInTheDocument()
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

describe('지표 목록 (목업 13 ② — 카드 열두 장 대신 한 목록)', () => {
  it('지표는 한 목록의 줄 — 받은 시각 · 출처가 같으면 위에 한 번, 다른 줄만 그 줄에 적는다', async () => {
    mockMacro({
      series: [
        series({ code: 'DGS10', name: '미 10년물 금리', note: '장기 금리의 기준' }),
        series({ code: 'DGS2', name: '미 2년물 금리' }),
        series({ code: 'VIX', name: 'VIX', source: 'yahoo', last_checked_at: '2026-09-20T01:00:00' }),
      ],
    })
    renderPanel()
    const list = await screen.findByRole('list')
    expect(within(list).getAllByRole('listitem')).toHaveLength(3)
    expect(document.querySelector('.macro-card')).toBeNull()
    // 공통 줄은 목록 위에 한 번
    expect(screen.getByText(/^\d+\/\d+ \d{2}:\d{2}에 받음 \(출처 fred_api\)$/)).toBeInTheDocument()
    const rows = within(list).getAllByRole('listitem')
    // 같은 줄은 시각 · 출처를 다시 쓰지 않는다
    expect(rows[0]).not.toHaveTextContent(/확인|fred_api/)
    expect(rows[0]).toHaveTextContent('장기 금리의 기준')
    // 다른 줄만 그 줄에
    expect(rows[2]).toHaveTextContent(/\d+\/\d+ \d{2}:\d{2} 확인, 출처 yahoo/)
    // 띄어 쓴 가운뎃점으로 잇지 않는다
    for (const row of rows) expect(row.textContent).not.toMatch(/ · /)
  })

  it('월간 지표는 "2026년 10월분"처럼 어느 해 어느 달 값인지 — 일간은 주기를 적지 않는다 (목업 14 ③ 가)', async () => {
    mockMacro({
      series: [
        series({ code: 'CPI', name: 'CPI', note: '소비자 물가', frequency: 'monthly', as_of: '2026-10-01' }),
        series({ code: 'DGS10', name: '미 10년물 금리' }),
      ],
    })
    renderPanel()
    const rows = within(await screen.findByRole('list')).getAllByRole('listitem')
    expect(rows[0]).toHaveTextContent('소비자 물가, 2026년 10월분')
    expect(rows[1]).not.toHaveTextContent(/일간/)
  })

  it('줄 단추의 읽는 이름에 풀이 · 값 · 변화가 같이 — 누르면 차트', async () => {
    mockMacro()
    renderPanel()
    expect(await screen.findByRole('button', { name: '미 10년물 금리, 장기 금리의 기준, 4.11% +0.06%p — 차트' })).toBeInTheDocument()
  })

  it('"받아본 적 없음"도 읽는 이름에 들어간다 — 이름을 덮어 써서 듣지 못했다 (검토 6 참고)', async () => {
    mockMacro({ series: [series({ code: 'FEARGREED', name: '공포·탐욕 지수', value: null, as_of: null, last_checked_at: null })] })
    renderPanel()
    expect(await screen.findByRole('button', { name: /^공포·탐욕 지수, 받아본 적 없음, / })).toBeInTheDocument()
  })
})

describe('달 표시 · 지표 코드 (목업 14 ③ 가)', () => {
  it('분기는 "2026년 3분기분", 주간은 "날짜 주", 일간은 적지 않는다', () => {
    expect(periodOf({ frequency: 'monthly', as_of: '2027-01-01' })).toBe('2027년 1월분')
    expect(periodOf({ frequency: 'quarterly', as_of: '2026-07-01' })).toBe('2026년 3분기분')
    expect(periodOf({ frequency: 'weekly', as_of: '2026-11-14' })).toBe('2026-11-14 주')
    expect(periodOf({ frequency: 'daily', as_of: '2026-11-18' })).toBe('')
    expect(periodOf({ frequency: 'monthly', as_of: null })).toBe('')
  })

  it('차트 창 제목 옆은 출처의 코드(CPIAUCSL) 대신 풀이 · 꼬리표 — 코드는 마우스를 올리면', async () => {
    mockMacro({ series: [series({ code: 'CPIAUCSL', name: 'CPI', note: '뉴스에 나오는 물가', frequency: 'monthly' })] })
    vi.spyOn(api, 'getMacroHistory').mockResolvedValue({ code: 'CPIAUCSL', name: 'CPI', unit: 'percent', transform: 'yoy', transform_label: '전년비', points: [] })
    renderPanel()
    await userEvent.click(await screen.findByRole('button', { name: /^CPI, .* — 차트$/ }))
    const dialog = await screen.findByRole('dialog')
    const sub = within(dialog).getByText('뉴스에 나오는 물가, 전년비')
    expect(sub).toHaveAttribute('title', 'CPIAUCSL')
    expect(dialog.textContent).not.toMatch(/CPIAUCSL/)
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
  it('★ 을 누르면 옮겨 간 자리의 별로 포커스 · 화면이 따라간다 — 폰에서 누른 줄이 화면 밖으로 사라졌다 (묶음 5 사용자 확인)', async () => {
    const two = [series({ code: 'DGS10', name: '미 10년물 금리' }), series({ code: 'VIX', name: 'VIX' })]
    mockMacro({ series: two, pinned: [] })
    // 저장 뒤 화면이 다시 읽을 때는 서버가 바뀐 별을 준다
    vi.spyOn(api, 'setMacroPinned').mockImplementation(async () => {
      vi.mocked(api.getMacro).mockResolvedValue({ series: two, term_spread: null, badges: [], pinned: ['VIX'] })
      return { codes: ['VIX'], series: [], badges: [] }
    })
    const scroll = vi.fn()
    const before = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = scroll
    try {
      const user = userEvent.setup()
      renderPanel()
      await user.click(await screen.findByRole('button', { name: 'VIX 내 지표로' }))
      const mine = await screen.findByRole('list', { name: '내 지표' })
      const star = within(mine).getByRole('button', { name: 'VIX 내 지표로' })
      await waitFor(() => expect(star).toHaveFocus())
      expect(scroll.mock.contexts).toContain(star)
      expect(screen.getByRole('status')).toHaveTextContent('VIX 을(를) 맨 위 내 지표로 옮겼습니다')
    } finally {
      Element.prototype.scrollIntoView = before
    }
  })

  it('고른 지표는 별이 켜져 있다', async () => {
    mockMacro({ pinned: ['DGS10'] })
    renderPanel()

    expect(await screen.findByRole('button', { name: /내 지표로/ })).toHaveAttribute(
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

    await user.click(await screen.findByRole('button', { name: /내 지표로/ }))

    expect(save).toHaveBeenCalledWith(['DGS10'])
  })

  it('켜져 있는 것을 누르면 빼고 저장한다', async () => {
    mockMacro({ pinned: ['DGS10'] })
    const save = vi.spyOn(api, 'setMacroPinned').mockResolvedValue({ codes: [], series: [], badges: [] })
    const user = userEvent.setup()
    renderPanel()

    await user.click(await screen.findByRole('button', { name: /내 지표로/ }))

    // **빈 목록을 그대로 보낸다** — "다 껐다"는 선택이고, 안 보내면 기본값으로 되돌아간다
    expect(save).toHaveBeenCalledWith([])
  })

  it('장단기 금리차에는 별이 없다 — 늘 목록 맨 위라 "내 지표"로 모을 줄이 아니다 (목업 14 ① 가)', async () => {
    mockMacro({
      term_spread: { as_of: '2026-09-21', value: -0.25, long_code: 'DGS10', short_code: 'DGS2' },
      pinned: [],
    })
    renderPanel()
    await screen.findByText(/장단기 금리차/)
    expect(screen.queryByRole('button', { name: /장단기 금리차/ })).toBeNull()
  })

  it('★ 켠 지표는 맨 위 "내 지표"로 모이고 나머지는 "모든 지표" — 홈에 올리던 뜻은 없어졌다 (목업 14 ① 가)', async () => {
    mockMacro({
      series: [series({ code: 'DGS10', name: '미 10년물 금리' }), series({ code: 'VIX', name: 'VIX' })],
      pinned: ['VIX'],
    })
    renderPanel()
    const mine = await screen.findByRole('list', { name: '내 지표' })
    expect(within(mine).getAllByRole('listitem').map((li) => li.querySelector('b')?.firstChild?.textContent)).toEqual(['VIX'])
    const all = screen.getByRole('list', { name: '모든 지표' })
    expect(within(all).getAllByRole('listitem').map((li) => li.querySelector('b')?.firstChild?.textContent)).toEqual(['미 10년물 금리'])
    expect(within(mine).getByRole('button', { name: 'VIX 내 지표로' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByText(/홈 화면/)).toBeNull()
  })

  it('★ 을 하나도 안 켰으면 "내 지표" 칸 없이 한 목록 — 별을 누르면 무엇이 되는지 한 줄', async () => {
    mockMacro({ pinned: [] })
    renderPanel()
    expect(await screen.findByRole('list', { name: '지표' })).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: '내 지표' })).toBeNull()
    expect(screen.getByText(/★ 을 누르면 그 지표가 맨 위 “내 지표”로 모입니다/)).toBeInTheDocument()
  })

  it('저장에 실패하면 별을 원래대로 되돌린다', async () => {
    mockMacro({ pinned: [] })
    vi.spyOn(api, 'setMacroPinned').mockRejectedValue(new Error('저장하지 못했습니다'))
    const user = userEvent.setup()
    renderPanel()

    await user.click(await screen.findByRole('button', { name: /내 지표로/ }))

    // 켜진 채로 두면 왜 맨 위에 남는지 알 수 없게 된다 — 줄이 "내 지표"로 갔다가 돌아온다
    await waitFor(() => expect(screen.getByRole('button', { name: /내 지표로/ })).toHaveAttribute('aria-pressed', 'false'))
    expect(screen.queryByRole('list', { name: '내 지표' })).toBeNull()
    expect(screen.getByText(/저장하지 못했습니다/)).toBeInTheDocument()
  })
})

describe('장단기 금리차 — 장식 없이 (목업 13 ④)', () => {
  it('정상이면 📐 없이 "장단기 금리차 +0.28%p, 정상(장기 > 단기)" — 코드 이름은 글 대신 풀이(title)로', async () => {
    mockMacro({ term_spread: { value: 0.28, as_of: '2026-11-18', long_code: 'DGS10', short_code: 'DGS2' } })
    renderPanel()
    const line = (await screen.findByText(/장단기 금리차 \+0\.28%p/)).closest('.callout')!
    expect(line).toHaveTextContent('장단기 금리차 +0.28%p, 정상(장기 > 단기) (2026-11-18 기준)')
    expect(line.textContent).not.toMatch(/📐|DGS10| — /)
    // 날짜는 한 덩어리 — "(2026-" / "11-18 기준)"으로 갈라졌다 (검토 6 조건 4)
    expect(within(line as HTMLElement).getByText('(2026-11-18 기준)')).toHaveClass('nowrap')
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
      await screen.findByText('여기 숫자는 매수·매도 시그널에 들어가지 않습니다.'),
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

    await user.click(await screen.findByRole('button', { name: /^미 10년물 금리, .* — 차트$/ }))

    const dialog = await screen.findByRole('dialog')
    // 시세 차트는 1년으로 열지만 매크로는 5년이다 — 지금이 높은지 낮은지는
    // 2020년이 화면에 있어야 보인다
    expect(within(dialog).getByRole('button', { name: '5년' })).toHaveClass('active')
    // 기간은 한 줄 고르기 — 고른 칸만 눌린 상태로 읽힌다 (목업 13 ③, 검토 6 참고)
    expect(within(dialog).getByRole('group', { name: '기간' })).toHaveClass('seg')
    expect(within(within(dialog).getByRole('group', { name: '기간' })).getAllByRole('button').filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent)).toEqual(['5년'])
    expect(api.getMacroHistory).toHaveBeenCalledWith('DGS10', '5y')
  })
})

describe('예상치 — 줄에는 한 마디, 입력은 차트 창 안 (목업 14 ②)', () => {
  /** 줄을 눌러 차트 창을 연다 — 예상치 입력칸은 창 안에 있다 */
  async function openChart(name = 'CPI') {
    vi.spyOn(api, 'getMacroHistory').mockResolvedValue({
      code: 'CPIAUCSL',
      name,
      unit: 'percent',
      transform: 'yoy',
      transform_label: '전년비',
      points: [],
    })
    await userEvent.click(await screen.findByRole('button', { name: new RegExp(`^${name}, .* — 차트$`) }))
    return screen.findByRole('dialog')
  }
  const cpi = (overrides: Partial<MacroSeriesInfo> = {}): MacroSeriesInfo =>
    series({
      code: 'CPIAUCSL',
      name: 'CPI',
      transform: 'yoy',
      transform_label: '전년비',
      frequency: 'monthly',
      as_of: '2026-08-01',
      value: 3.2,
      forecastable: true,
      ...overrides,
    })

  const forecast = (overrides = {}) => ({
    as_of: '2026-08-01',
    value: 3.0,
    source: 'manual',
    source_label: '직접 입력',
    forecast_date: '2026-09-10',
    surprise: 0.2,
    ...overrides,
  })

  it('예상치가 있으면 예상보다 얼마나 높았는지 · 낮았는지 말로 — "실제 +0.20%p"는 실제 값처럼 읽혔다 (묶음 5 사용자 확인)', async () => {
    mockMacro({ series: [cpi({ forecast: forecast() })] })
    renderPanel()

    // 줄에는 한 마디 — 0.2%가 아니라 0.2%p다(전년비끼리의 차이라 %로 읽으면 다른 숫자가 된다)
    expect(await screen.findByText('예상 3.00%, 예상보다 0.20%p 높음')).toBeInTheDocument()
    // 누가 넣은 예상인지는 창 안에 — "직접 입력"은 누가 넣었는지 몰랐다
    const dialog = await openChart()
    expect(within(dialog).getByText(/관리자가 넣음/)).toBeInTheDocument()
    expect(within(dialog).getByText('예상보다 0.20%p 높음')).toBeInTheDocument()
    expect(dialog.textContent).not.toMatch(/실제 \+/)
  })

  it('예상보다 낮으면 "낮음", 같으면 "예상과 같음"', async () => {
    mockMacro({ series: [cpi({ forecast: forecast({ surprise: -0.07 }) })] })
    renderPanel()
    expect(await screen.findByText('예상 3.00%, 예상보다 0.07%p 낮음')).toBeInTheDocument()
  })

  it('아직 발표 전인 달의 예상치는 그렇다고 말한다', async () => {
    mockMacro({
      series: [
        cpi({
          forecast: forecast(),
          pending_forecast: forecast({ as_of: '2026-09-01', value: 2.9, surprise: null }),
        }),
      ],
    })
    renderPanel()

    // 줄에는 이번 발표 결과 한 마디, 창 안에는 둘 다 — 한 칸에 합치면 하나가 다른 하나를 가린다
    expect(await screen.findByText(/예상 3.00%/)).toBeInTheDocument()
    const dialog = await openChart()
    const lines = Array.from(dialog.querySelectorAll('.macro-forecast')).map((p) => p.textContent)
    expect(lines).toEqual([expect.stringMatching(/^2026-08 예상 3.00%예상보다 0.20%p 높음 \(관리자가 넣음\)/), expect.stringMatching(/^2026-09 예상 2.90% \(아직 발표 전, 관리자가 넣음\)/)])
  })

  it('예상치만 있고 아직 발표 전이면 줄에도 그 한 마디 — "2026-09 예상 2.90%(발표 전)"', async () => {
    mockMacro({ series: [cpi({ pending_forecast: forecast({ as_of: '2026-09-01', value: 2.9, surprise: null }) })] })
    renderPanel()
    expect(await screen.findByText('2026-09 예상 2.90%(발표 전)')).toBeInTheDocument()
  })

  it('매일 나오는 값에는 입력칸을 띄우지 않는다 — 차트 창 안에도 (검토 5 조건 2)', async () => {
    mockMacro()
    renderPanel()
    await screen.findByText('미 10년물 금리')
    expect(screen.queryByRole('button', { name: '예상치 입력' })).not.toBeInTheDocument()
    vi.spyOn(api, 'getMacroHistory').mockResolvedValue({ code: 'DGS10', name: '미 10년물 금리', unit: 'percent', transform: 'none', transform_label: null, points: [] })
    await userEvent.click(screen.getByRole('button', { name: /^미 10년물 금리, .* — 차트$/ }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByRole('button', { name: '예상치 입력' })).toBeNull()
    expect(dialog.querySelector('.macro-forecast-box')).toBeNull()
  })

  it('입력칸은 마지막 발표의 다음 달로 열린다', async () => {
    mockMacro({ series: [cpi()] })
    renderPanel()

    await userEvent.click(within(await openChart()).getByRole('button', { name: '예상치 입력' }))

    // 예상치를 적는 때는 보통 발표 전이고, 그때 궁금한 건 아직 안 나온 달이다
    expect(screen.getByLabelText('CPI 예상치가 가리키는 달')).toHaveValue('2026-09')
  })

  it('저장하면 그 달 1일로 보낸다', async () => {
    mockMacro({ series: [cpi()] })
    const save = vi.spyOn(api, 'setMacroForecast').mockResolvedValue(cpi())
    renderPanel()

    await userEvent.click(within(await openChart()).getByRole('button', { name: '예상치 입력' }))
    await userEvent.type(screen.getByLabelText('CPI 예상치'), '2.7')
    await userEvent.click(screen.getByRole('button', { name: '저장' }))

    // 값이 그 달 1일로 저장돼 있어서, 날짜를 안 맞추면 영영 짝이 안 맞는다
    await waitFor(() => expect(save).toHaveBeenCalledWith('CPIAUCSL', '2026-09-01', 2.7))
  })

  it('전년비가 마이너스인 달도 적을 수 있다', async () => {
    mockMacro({ series: [cpi()] })
    const save = vi.spyOn(api, 'setMacroForecast').mockResolvedValue(cpi())
    renderPanel()

    await userEvent.click(within(await openChart()).getByRole('button', { name: '예상치 입력' }))
    await userEvent.type(screen.getByLabelText('CPI 예상치'), '-0.2')
    await userEvent.click(screen.getByRole('button', { name: '저장' }))

    // 빼기표를 버리면 −0.2 를 넣었는데 0.2 가 저장된다 (2009·2015년 CPI 가 실제로 마이너스였다)
    await waitFor(() => expect(save).toHaveBeenCalledWith('CPIAUCSL', '2026-09-01', -0.2))
  })

  it('저장하고 나면 화면을 다시 읽는다 — 배지가 예상치를 보고 뜨기 때문이다', async () => {
    mockMacro({ series: [cpi()] })
    vi.spyOn(api, 'setMacroForecast').mockResolvedValue(cpi())
    renderPanel()

    await userEvent.click(within(await openChart()).getByRole('button', { name: '예상치 입력' }))
    await userEvent.type(screen.getByLabelText('CPI 예상치'), '2.7')
    await userEvent.click(screen.getByRole('button', { name: '저장' }))

    await waitFor(() => expect(api.getMacro).toHaveBeenCalledTimes(2))
  })

  it('지우기는 나와 있는 예상마다 — 입력칸이 다음 달로 잡혀 지난달 예상이 안 지워졌다 (묶음 5 사용자 확인)', async () => {
    mockMacro({ series: [cpi({ forecast: forecast() })] })
    const clear = vi.spyOn(api, 'clearMacroForecast').mockResolvedValue(cpi())
    renderPanel()
    const dialog = await openChart()
    await userEvent.click(within(dialog).getByRole('button', { name: '2026-08 예상 지우기' }))
    await waitFor(() => expect(clear).toHaveBeenCalledWith('CPIAUCSL', '2026-08-01'))
    // 입력칸에는 지우기가 없다 — 무엇을 지우는지 모호했다
    await userEvent.click(within(dialog).getByRole('button', { name: '예상치 입력' }))
    expect(within(dialog).queryByRole('button', { name: '지우기' })).toBeNull()
  })

  it('그 달 예상이 이미 있으면 입력칸을 그 값으로 연다 — 빈 칸에 회색 예시만 보여 바뀐 것처럼 읽혔다', async () => {
    mockMacro({ series: [cpi({ pending_forecast: forecast({ as_of: '2026-09-01', value: 2.9, surprise: null }) })] })
    renderPanel()
    const dialog = await openChart()
    await userEvent.click(within(dialog).getByRole('button', { name: '예상치 입력' }))
    expect(within(dialog).getByLabelText('CPI 예상치')).toHaveValue('2.9')
    expect(within(dialog).getByLabelText('CPI 예상치')).toHaveAttribute('placeholder', '예: 2.7')
  })

  it('예상치가 없으면 지인에게 그렇다고 말한다 — 어디서 찾아도 없어 헤맸다 (묶음 5 사용자 확인)', async () => {
    vi.spyOn(api, 'getAuthStatus').mockResolvedValue({
      locked: true, authenticated: true, mode: 'google', user: { email: 'f@x.y', name: '친구', is_owner: false }, config_problem: null,
    })
    mockMacro({ series: [cpi()] })
    render(
      <MemoryRouter>
        <AuthGate>
          <AppStateProvider>
            <MacroPanel />
          </AppStateProvider>
        </AuthGate>
      </MemoryRouter>,
    )
    const dialog = await openChart()
    expect(within(dialog).getByText(/아직 넣은 예상치가 없습니다/)).toBeInTheDocument()
  })

  it('빈 칸으로는 저장할 수 없다', async () => {
    mockMacro({ series: [cpi()] })
    renderPanel()

    await userEvent.click(within(await openChart()).getByRole('button', { name: '예상치 입력' }))

    expect(screen.getByRole('button', { name: '저장' })).toBeDisabled()
  })

  it('저장이 실패하면 이유를 창 안에 띄우고 입력칸을 닫지 않는다 — 창 뒤에 띄우면 가려진다', async () => {
    mockMacro({ series: [cpi()] })
    vi.spyOn(api, 'setMacroForecast').mockRejectedValue(new Error('너무 먼 미래입니다'))
    renderPanel()

    const dialog = await openChart()
    await userEvent.click(within(dialog).getByRole('button', { name: '예상치 입력' }))
    await userEvent.type(within(dialog).getByLabelText('CPI 예상치'), '2.7')
    await userEvent.click(within(dialog).getByRole('button', { name: '저장' }))

    expect(await within(dialog).findByText(/너무 먼 미래입니다/)).toBeInTheDocument()
    // 닫아버리면 방금 친 숫자를 다시 쳐야 한다
    expect(within(dialog).getByLabelText('CPI 예상치')).toBeInTheDocument()
  })

  it('저장이 실패해도 포커스가 폼 안에 남고, Esc 는 폼만 닫는다 — 단추가 잠기며 body 로 떨어져 창째 닫혔다 (재검토 조건 1)', async () => {
    mockMacro({ series: [cpi()] })
    vi.spyOn(api, 'setMacroForecast').mockRejectedValue(new Error('너무 먼 미래입니다'))
    renderPanel()
    const dialog = await openChart()
    await userEvent.click(within(dialog).getByRole('button', { name: '예상치 입력' }))
    await userEvent.type(within(dialog).getByLabelText('CPI 예상치'), '2.7')
    await userEvent.click(within(dialog).getByRole('button', { name: '저장' }))
    await within(dialog).findByText(/너무 먼 미래입니다/)
    expect(within(dialog).getByRole('button', { name: '저장' })).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(within(dialog).queryByLabelText('CPI 예상치')).toBeNull()
  })

  it('저장하는 동안 단추는 잠긴 것으로 읽히되 disabled 는 아니다 — disabled 면 브라우저가 포커스를 body 로 뺀다 (재검토 조건 1)', async () => {
    mockMacro({ series: [cpi()] })
    let finish = () => {}
    vi.spyOn(api, 'setMacroForecast').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve(cpi())
        }),
    )
    renderPanel()
    const dialog = await openChart()
    await userEvent.click(within(dialog).getByRole('button', { name: '예상치 입력' }))
    await userEvent.type(within(dialog).getByLabelText('CPI 예상치'), '2.7')
    await userEvent.click(within(dialog).getByRole('button', { name: '저장' }))
    const save = within(dialog).getByRole('button', { name: '저장' })
    expect(save).toHaveAttribute('aria-disabled', 'true')
    expect(save).not.toBeDisabled()
    // 눌리긴 해도 한 번만 저장한다 — 막는 것은 busy (세 번째 검토 조건 2)
    await userEvent.click(save)
    expect(api.setMacroForecast).toHaveBeenCalledTimes(1)
    finish()
    await waitFor(() => expect(within(dialog).queryByLabelText('CPI 예상치')).toBeNull())
  })

  it('지우는 동안 두 번 눌러도 한 번만 지운다 (세 번째 검토 조건 2)', async () => {
    mockMacro({ series: [cpi({ forecast: forecast() })] })
    let finish = () => {}
    const clear = vi.spyOn(api, 'clearMacroForecast').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve(cpi())
        }),
    )
    renderPanel()
    const dialog = await openChart()
    const remove = within(dialog).getByRole('button', { name: '2026-08 예상 지우기' })
    await userEvent.click(remove)
    expect(remove).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(remove)
    expect(clear).toHaveBeenCalledTimes(1)
    finish()
    await waitFor(() => expect(within(dialog).getByRole('button', { name: '예상치 입력' })).toHaveFocus())
  })

  it('폼이 열린 채 위 줄의 "지우기"를 눌러도 포커스는 폼의 달 칸 — body 로 떨어져 Esc 가 창째 닫았다 (세 번째 검토 조건 1)', async () => {
    mockMacro({ series: [cpi({ forecast: forecast() })] })
    vi.spyOn(api, 'clearMacroForecast').mockResolvedValue(cpi())
    renderPanel()
    const dialog = await openChart()
    await userEvent.click(within(dialog).getByRole('button', { name: '예상치 입력' }))
    await userEvent.type(within(dialog).getByLabelText('CPI 예상치'), '2.8')
    await userEvent.click(within(dialog).getByRole('button', { name: '2026-08 예상 지우기' }))
    await waitFor(() => expect(within(dialog).getByLabelText('CPI 예상치가 가리키는 달')).toHaveFocus())
    await userEvent.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('★ 저장이 실패하면 되돌아간 자리의 별로 포커스 · 알림 "옮기지 못했습니다" (세 번째 검토 참고)', async () => {
    mockMacro({ series: [series({ code: 'VIX', name: 'VIX' })], pinned: [] })
    // 서버가 늦게 실패한다 — 먼저 "내 지표"로 옮긴 별에 포커스가 간 뒤 되돌아간다(실제 화면 순서)
    let fail = () => {}
    vi.spyOn(api, 'setMacroPinned').mockImplementation(
      () =>
        new Promise((_, reject) => {
          fail = () => reject(new Error('저장하지 못했습니다'))
        }),
    )
    renderPanel()
    await userEvent.click(await screen.findByRole('button', { name: 'VIX 내 지표로' }))
    const mine = await screen.findByRole('list', { name: '내 지표' })
    await waitFor(() => expect(within(mine).getByRole('button', { name: 'VIX 내 지표로' })).toHaveFocus())
    fail()
    await waitFor(() => expect(screen.getByRole('button', { name: 'VIX 내 지표로' })).toHaveAttribute('aria-pressed', 'false'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'VIX 내 지표로' })).toHaveFocus())
    expect(screen.getByRole('status')).toHaveTextContent('VIX 을(를) 옮기지 못했습니다')
  })

  it('지우면 포커스가 "예상치 입력"으로 — 지운 줄의 단추가 사라져 body 로 떨어졌다 (재검토 조건 1)', async () => {
    mockMacro({ series: [cpi({ forecast: forecast() })] })
    vi.spyOn(api, 'clearMacroForecast').mockResolvedValue(cpi())
    renderPanel()
    const dialog = await openChart()
    await userEvent.click(within(dialog).getByRole('button', { name: '2026-08 예상 지우기' }))
    await waitFor(() => expect(within(dialog).getByRole('button', { name: '예상치 입력' })).toHaveFocus())
  })

  it('보이는 자리에서 차이가 0 이면 "예상과 같음" — 2.65 를 넣었는데 "0.00%p 낮음"이 났다 (재검토 조건 2)', async () => {
    mockMacro({ series: [cpi({ forecast: forecast({ surprise: -0.00012 }) })] })
    renderPanel()
    expect(await screen.findByText('예상 3.00%, 예상과 같음')).toBeInTheDocument()
    expect(screen.queryByText(/0\.00%p/)).toBeNull()
  })

  it('예상 지우기는 관리자만 — 지인 창에는 예상 줄만, 관리자 창에는 "예상 없음" 안내가 없다 (재검토 조건 3)', async () => {
    vi.spyOn(api, 'getAuthStatus').mockResolvedValue({
      locked: true, authenticated: true, mode: 'google', user: { email: 'f@x.y', name: '친구', is_owner: false }, config_problem: null,
    })
    mockMacro({ series: [cpi({ forecast: forecast() })] })
    render(
      <MemoryRouter>
        <AuthGate>
          <AppStateProvider>
            <MacroPanel />
          </AppStateProvider>
        </AuthGate>
      </MemoryRouter>,
    )
    const dialog = await openChart()
    expect(within(dialog).getByText(/예상 3.00%/)).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: /지우기/ })).toBeNull()
  })

  it('관리자 창에는 "아직 넣은 예상치가 없습니다"가 없다 — 대신 입력 단추', async () => {
    mockMacro({ series: [cpi()] })
    renderPanel()
    const dialog = await openChart()
    expect(within(dialog).queryByText(/아직 넣은 예상치가 없습니다/)).toBeNull()
    expect(within(dialog).getByRole('button', { name: '예상치 입력' })).toBeInTheDocument()
  })

  it('실패 까닭은 그 창 것 — 닫고 다른 지표 창을 열면 남아 있지 않다 (검토 5 조건 1)', async () => {
    mockMacro({ series: [cpi(), cpi({ code: 'PCEPILFE', name: '근원 PCE' })] })
    vi.spyOn(api, 'setMacroForecast').mockRejectedValue(new Error('너무 먼 미래입니다'))
    renderPanel()

    const first = await openChart()
    await userEvent.click(within(first).getByRole('button', { name: '예상치 입력' }))
    await userEvent.type(within(first).getByLabelText('CPI 예상치'), '2.7')
    await userEvent.click(within(first).getByRole('button', { name: '저장' }))
    await within(first).findByText(/너무 먼 미래입니다/)
    await userEvent.click(within(first).getByRole('button', { name: '닫기' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    // 창 밖 화면에도 남지 않는다
    expect(screen.queryByText(/너무 먼 미래입니다/)).toBeNull()
    const second = await openChart('근원 PCE')
    expect(within(second).queryByText(/너무 먼 미래입니다/)).toBeNull()
  })

  it('저장하면 열린 창 안의 예상이 새 값으로 바뀐다 — 창은 목록의 새 값을 읽는다 (검토 5 조건 2)', async () => {
    mockMacro({ series: [cpi()] })
    vi.spyOn(api, 'setMacroForecast').mockImplementation(async () => {
      vi.mocked(api.getMacro).mockResolvedValue({
        series: [cpi({ pending_forecast: forecast({ as_of: '2026-09-01', value: 2.7, surprise: null }) })],
        term_spread: null,
        badges: [],
        pinned: [],
      })
      return cpi()
    })
    renderPanel()
    const dialog = await openChart()
    await userEvent.click(within(dialog).getByRole('button', { name: '예상치 입력' }))
    await userEvent.type(within(dialog).getByLabelText('CPI 예상치'), '2.7')
    await userEvent.click(within(dialog).getByRole('button', { name: '저장' }))
    expect(await within(dialog).findByText(/2026-09/)).toBeInTheDocument()
    expect(within(dialog).getByText(/예상 2.70%/)).toBeInTheDocument()
  })

  it('키보드: 창을 열면 포커스가 창 안, "예상치 입력"을 누르면 달 칸, 폼에서 Esc 는 폼만 닫고 "예상치 입력"으로 (검토 5 조건 3)', async () => {
    mockMacro({ series: [cpi()] })
    renderPanel()
    const dialog = await openChart()
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
    await userEvent.click(within(dialog).getByRole('button', { name: '예상치 입력' }))
    expect(within(dialog).getByLabelText('CPI 예상치가 가리키는 달')).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(within(dialog).queryByLabelText('CPI 예상치')).toBeNull()
    expect(within(dialog).getByRole('button', { name: '예상치 입력' })).toHaveFocus()
    // 폼이 닫혀 있으면 Esc 는 창을 닫는다
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})

// ---------------------------------------------------------------------------
//  누가 무엇을 누를 수 있나 (4-4)
// ---------------------------------------------------------------------------

describe('손님·사용자·관리자', () => {
  function renderAs(auth: Partial<AuthStatus>) {
    vi.spyOn(api, 'getAuthStatus').mockResolvedValue({
      locked: true, authenticated: false, mode: 'google', user: null, config_problem: null, ...auth,
    })
    mockMacro({
      series: [series({ code: 'CPIAUCSL', name: 'CPI', frequency: 'monthly', forecastable: true })],
      term_spread: { as_of: '2026-09-21', value: 0.5, long_code: 'DGS10', short_code: 'DGS2' },
    })
    return render(
      <MemoryRouter>
        <AuthGate>
          <AppStateProvider>
            <MacroPanel />
          </AppStateProvider>
        </AuthGate>
      </MemoryRouter>,
    )
  }

  it('손님은 둘러보기만 — 별도 받아오기도 예상치 입력도 없다(차트 창 안에도), 서버가 기본 별을 줘도 "내 지표" 칸이 없다', async () => {
    vi.spyOn(api, 'getAuthStatus').mockResolvedValue({
      locked: true, authenticated: false, mode: 'google', user: null, config_problem: null,
    })
    // 서버는 손님에게도 기본 별(VIX · 금리차 · 공포·탐욕)을 준다 (검토 5 조건 2)
    mockMacro({
      series: [series({ code: 'CPIAUCSL', name: 'CPI', frequency: 'monthly', forecastable: true }), series({ code: 'VIX', name: 'VIX' })],
      term_spread: { as_of: '2026-09-21', value: 0.5, long_code: 'DGS10', short_code: 'DGS2' },
      pinned: ['VIX', 'TERM_SPREAD', 'FEARGREED'],
    })
    render(
      <MemoryRouter>
        <AuthGate>
          <AppStateProvider>
            <MacroPanel />
          </AppStateProvider>
        </AuthGate>
      </MemoryRouter>,
    )
    expect(await screen.findByText('CPI')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /내 지표로/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '지금 받아오기' })).not.toBeInTheDocument()
    expect(screen.queryByRole('list', { name: '내 지표' })).toBeNull()
    expect(screen.getByRole('list', { name: '지표' })).toBeInTheDocument()
    // AI 는 자기 키로 쓰는 사람만 — 손님에게는 버튼이 없다
    expect(screen.queryByRole('button', { name: 'AI 매크로 정리' })).not.toBeInTheDocument()
    vi.spyOn(api, 'getMacroHistory').mockResolvedValue({ code: 'CPIAUCSL', name: 'CPI', unit: 'percent', transform: 'none', transform_label: null, points: [] })
    await userEvent.click(screen.getByRole('button', { name: /^CPI, .* — 차트$/ }))
    expect(within(await screen.findByRole('dialog')).queryByRole('button', { name: '예상치 입력' })).toBeNull()
  })

  it('사용자는 "AI 정리"로 매크로 정리 창을 연다 — 여는 것만으로 부르지는 않는다', async () => {
    const analyze = vi.spyOn(api, 'aiAnalyzeStream')
    renderAs({ authenticated: true, user: { email: 'f@x.y', name: '친구', is_owner: false } })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'AI 매크로 정리' }))
    const dialog = await screen.findByRole('dialog', { name: 'AI 매크로 정리' })
    expect(within(dialog).getByText(/앞으로의 방향은 점치지 않도록/)).toBeInTheDocument()
    expect(analyze).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: '닫기' }))
    expect(screen.queryByRole('dialog', { name: 'AI 매크로 정리' })).not.toBeInTheDocument()
  })

  it('사용자는 내 지표 별까지 — 전원이 보는 받아오기·예상치는 관리자 몫이다', async () => {
    renderAs({ authenticated: true, user: { email: 'f@x.y', name: '친구', is_owner: false } })
    expect(await screen.findByText('CPI')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'CPI 내 지표로' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '지금 받아오기' })).not.toBeInTheDocument()
    // 차트 창을 열어도 예상치 입력이 없다
    vi.spyOn(api, 'getMacroHistory').mockResolvedValue({ code: 'CPIAUCSL', name: 'CPI', unit: 'percent', transform: 'none', transform_label: null, points: [] })
    await userEvent.click(screen.getByRole('button', { name: /^CPI, .* — 차트$/ }))
    expect(within(await screen.findByRole('dialog')).queryByRole('button', { name: '예상치 입력' })).not.toBeInTheDocument()
  })

  it('관리자는 전부 — 예상치 입력은 줄 아래가 아니라 차트 창 안 (목업 14 ②)', async () => {
    renderAs({ authenticated: true, user: { email: 'me@x.y', name: '나', is_owner: true } })
    expect(await screen.findByText('CPI')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'CPI 내 지표로' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '지금 받아오기' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '예상치 입력' })).not.toBeInTheDocument()
    vi.spyOn(api, 'getMacroHistory').mockResolvedValue({ code: 'CPIAUCSL', name: 'CPI', unit: 'percent', transform: 'none', transform_label: null, points: [] })
    await userEvent.click(screen.getByRole('button', { name: /^CPI, .* — 차트$/ }))
    expect(within(await screen.findByRole('dialog')).getByRole('button', { name: '예상치 입력' })).toBeInTheDocument()
  })
})
