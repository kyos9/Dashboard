import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../api/client'
import { AppStateProvider } from '../AppState'
import type { MacroPinned, MacroSeriesInfo } from '../types'
import { MacroStrip } from './MacroStrip'

function series(overrides: Partial<MacroSeriesInfo> & { code: string }): MacroSeriesInfo {
  return {
    name: overrides.code,
    note: null,
    unit: 'level',
    transform: 'none',
    transform_label: null,
    frequency: 'daily',
    as_of: '2026-09-21',
    value: 18.4,
    previous: 17.9,
    change: 0.5,
    released_at: null,
    source: 'yahoo',
    zone: null,
    stale: false,
    last_checked_at: '2026-09-21T23:00:00',
    last_ok_at: '2026-09-21T23:00:00',
    last_error: null,
    ...overrides,
  }
}

function mockPinned(body: Partial<MacroPinned> = {}) {
  return vi.spyOn(api, 'getMacroPinned').mockResolvedValue({
    codes: ['VIX'],
    series: [series({ code: 'VIX', name: 'VIX' })],
    badges: [],
    ...body,
  })
}

function renderStrip() {
  return render(
    <MemoryRouter>
      <AppStateProvider>
        <MacroStrip />
      </AppStateProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('홈 화면 매크로 한 줄', () => {
  it('고른 지표를 값과 함께 보여준다', async () => {
    mockPinned()
    renderStrip()

    expect(await screen.findByText('VIX')).toBeInTheDocument()
    expect(screen.getByText('18.4')).toBeInTheDocument()
    expect(screen.getByText('+0.5')).toBeInTheDocument()
  })

  it('고른 순서를 그대로 지킨다', async () => {
    mockPinned({
      codes: ['DGS10', 'VIX'],
      series: [
        series({ code: 'DGS10', name: '미 10년물 금리', unit: 'percent', value: 4.11 }),
        series({ code: 'VIX', name: 'VIX' }),
      ],
    })
    renderStrip()

    await screen.findByText('VIX')
    const names = Array.from(document.querySelectorAll('.macro-chip-name')).map(
      (el) => el.textContent,
    )
    expect(names).toEqual(['미 10년물 금리', 'VIX'])
  })

  it('구간이 있는 지표는 점수 옆에 구간 이름을 쓴다', async () => {
    mockPinned({
      codes: ['FEARGREED'],
      series: [
        series({
          code: 'FEARGREED',
          name: '공포·탐욕 지수',
          value: 33.7,
          zone: { label: '공포', range: '25~44', extreme: false },
        }),
      ],
    })
    renderStrip()

    expect(await screen.findByText('공포')).toBeInTheDocument()
  })

  it('누르면 매크로 탭으로 간다 — 자세한 것은 거기서 본다', async () => {
    mockPinned()
    renderStrip()

    expect(await screen.findByRole('link', { name: /VIX/ })).toHaveAttribute('href', '/macro')
  })

  it('다 껐으면 지표 줄 자체가 없다', async () => {
    mockPinned({ codes: [], series: [] })
    const { container } = renderStrip()

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(container.querySelector('.macro-strip')).toBeNull()
  })

  it('장단기 금리차도 지표 하나처럼 한 줄에 들어간다', async () => {
    mockPinned({
      codes: ['TERM_SPREAD'],
      series: [
        series({
          code: 'TERM_SPREAD',
          name: '장단기 금리차',
          unit: 'percent',
          value: -0.25,
          change: -0.1,
        }),
      ],
    })
    renderStrip()

    expect(await screen.findByText('장단기 금리차')).toBeInTheDocument()
    expect(screen.getByText('-0.25%')).toBeInTheDocument()
  })

  it('국면 배지도 홈에 같이 뜬다', async () => {
    mockPinned({
      badges: [
        { key: 'vix_fear', label: '공포 구간', detail: 'VIX 32.4', tone: 'amber', as_of: null },
      ],
    })
    renderStrip()

    expect(await screen.findByText('공포 구간')).toBeInTheDocument()
    expect(screen.getByText('VIX 32.4')).toBeInTheDocument()
  })

  it('지표를 다 내려도 배지는 남는다 — 껐다는 건 "알리지 말라"가 아니다', async () => {
    mockPinned({
      codes: [],
      series: [],
      badges: [
        {
          key: 'inverted_curve',
          label: '장단기 금리 역전',
          detail: 'DGS10 − DGS2 -0.27%p',
          tone: 'amber',
          as_of: null,
        },
      ],
    })
    const { container } = renderStrip()

    expect(await screen.findByText('장단기 금리 역전')).toBeInTheDocument()
    expect(container.querySelector('.macro-strip')).toBeNull()
  })

  it('배지도 칩도 없으면 홈에 아무것도 안 붙는다', async () => {
    mockPinned({ codes: [], series: [], badges: [] })
    const { container } = renderStrip()

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(container.querySelector('.macro-home')).toBeNull()
  })

  it('매크로를 못 받아와도 홈에 오류를 띄우지 않는다 — 종목 표를 가리면 안 된다', async () => {
    vi.spyOn(api, 'getMacroPinned').mockRejectedValue(new Error('백엔드가 응답하지 않습니다'))
    const { container } = renderStrip()

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(container.querySelector('.macro-strip')).toBeNull()
    expect(screen.queryByText(/응답하지 않습니다/)).not.toBeInTheDocument()
  })
})
