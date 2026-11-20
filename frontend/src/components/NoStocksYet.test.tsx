import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { NoStocksYet } from './NoStocksYet'

function StocksProbe() {
  const state = useLocation().state as { focusSearch?: boolean } | null
  return <p>종목 탭 {state?.focusSearch ? '커서' : '그냥'}</p>
}

describe('종목 0개 빈 화면 (리밸런싱 · 재무)', () => {
  it('"종목 담으러 가기"는 종목 탭으로, 찾기 칸에 커서를 두라는 표시와 함께 (묶음 6 검토 6-2 조건 3)', async () => {
    render(
      <MemoryRouter initialEntries={['/rebalance']}>
        <Routes>
          <Route path="/rebalance" element={<NoStocksYet title="리밸런싱할 종목이 없습니다" shows="목표 비중과 지금 비중이" />} />
          <Route path="/stocks" element={<StocksProbe />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByRole('heading', { name: '리밸런싱할 종목이 없습니다' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('link', { name: '종목 담으러 가기' }))
    expect(await screen.findByText('종목 탭 커서')).toBeInTheDocument()
  })
})
