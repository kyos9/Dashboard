/**
 * AI 정리 화면 (디자인 4차 묶음 2) — 예전 창(팝업)이 화면 하나가 되었다.
 * 무엇이 가고 무엇이 안 가는지 먼저 적고, 누르기 전에는 부르지 않는다. ‹ 는 온 곳으로.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../api/client'
import { AiSummaryPage } from './AiSummaryPage'

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={['/', path]} initialIndex={1}>
      <Routes>
        <Route path="/ai/:kind" element={<AiSummaryPage />} />
        <Route path="/" element={<p>홈 화면</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('AI 정리 화면', () => {
  it('포트폴리오 진단 — 비중·수익률(%)만 보낸다고 먼저 적고, 들어오기만으로는 부르지 않는다', async () => {
    const stream = vi.spyOn(api, 'aiAnalyzeStream')
    renderAt('/ai/portfolio')
    expect(screen.getByRole('heading', { name: 'AI 포트폴리오 진단' })).toBeInTheDocument()
    expect(screen.getByText(/금액은 보내지 않습니다/)).toBeInTheDocument()
    expect(await screen.findByText(/평가금액·수량·평단가·현금 액수는 보내지 않습니다/)).toBeInTheDocument()
    expect(stream).not.toHaveBeenCalled()
  })

  it('전체 정리 — 보유는 보내지 않는다', async () => {
    renderAt('/ai/watchlist')
    expect(screen.getByRole('heading', { name: 'AI 전체 정리' })).toBeInTheDocument()
    expect(await screen.findByText(/보유수량·비중·평단가는 보내지 않습니다/)).toBeInTheDocument()
  })

  it('‹ 는 온 곳으로', async () => {
    renderAt('/ai/watchlist')
    await userEvent.click(screen.getByRole('button', { name: '뒤로' }))
    expect(await screen.findByText('홈 화면')).toBeInTheDocument()
  })

  it('모르는 종류는 없는 화면', () => {
    renderAt('/ai/macro')
    expect(screen.getByRole('heading', { name: '없는 화면입니다' })).toBeInTheDocument()
  })
})
