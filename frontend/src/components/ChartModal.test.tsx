import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../api/client'
import type { HistoryResponse } from '../types'
import { ChartModal } from './ChartModal'

const series = { setData: vi.fn() }
const chart = {
  addSeries: vi.fn(() => series),
  applyOptions: vi.fn(),
  remove: vi.fn(),
  timeScale: () => ({ fitContent: vi.fn() }),
}
const createChart = vi.fn(() => chart)

vi.mock('lightweight-charts', () => ({
  createChart: (...args: unknown[]) => createChart(...(args as [])),
  createSeriesMarkers: () => ({ setMarkers: vi.fn() }),
  LineSeries: 'Line',
  PriceScaleMode: { Logarithmic: 1 },
}))

const HISTORY: HistoryResponse = {
  ticker: '005930.KS',
  prices: [
    { date: '2026-09-15', close: 76_000 },
    { date: '2026-09-16', close: 76_900 },
  ],
  markers: [{ date: '2026-09-16', kind: 'buy_signal', status: 'recommended' }],
}

beforeEach(() => {
  vi.restoreAllMocks()
  createChart.mockClear()
  series.setData.mockClear()
})

describe('차트 팝업', () => {
  it('종목 이름과 차트를 띄운다', async () => {
    vi.spyOn(api, 'getHistory').mockResolvedValue(HISTORY)
    render(<ChartModal ticker="005930.KS" name="삼성전자" onClose={() => {}} />)

    expect(screen.getByRole('dialog', { name: /삼성전자 차트/ })).toBeInTheDocument()
    await waitFor(() => expect(createChart).toHaveBeenCalled())
    await waitFor(() => expect(series.setData).toHaveBeenCalled())
  })

  it('기간을 바꾸면 그 기간으로 다시 불러온다', async () => {
    const history = vi.spyOn(api, 'getHistory').mockResolvedValue(HISTORY)
    const user = userEvent.setup()
    render(<ChartModal ticker="005930.KS" name="삼성전자" onClose={() => {}} />)

    await waitFor(() => expect(history).toHaveBeenCalledWith('005930.KS', '1y'))
    await user.click(screen.getByRole('button', { name: '전체' }))
    await waitFor(() => expect(history).toHaveBeenCalledWith('005930.KS', 'max'))
  })

  it('ESC와 닫기 버튼으로 닫힌다', async () => {
    vi.spyOn(api, 'getHistory').mockResolvedValue(HISTORY)
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<ChartModal ticker="VOO" onClose={onClose} />)

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: '닫기' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('시세를 못 불러와도 팝업은 닫히지 않고 이유를 보여준다', async () => {
    vi.spyOn(api, 'getHistory').mockRejectedValue(new Error('백엔드가 응답하지 않습니다'))
    render(<ChartModal ticker="VOO" onClose={() => {}} />)

    expect(await screen.findByText(/백엔드가 응답하지 않습니다/)).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('닫히면 뒤 화면 스크롤을 되돌린다', async () => {
    vi.spyOn(api, 'getHistory').mockResolvedValue(HISTORY)
    const { unmount } = render(<ChartModal ticker="VOO" onClose={() => {}} />)

    expect(document.body.style.overflow).toBe('hidden')
    unmount()
    expect(document.body.style.overflow).not.toBe('hidden')
  })
})
