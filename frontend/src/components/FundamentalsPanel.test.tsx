import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FUNDAMENTALS } from '../test/fundamentalsFixture'
import { FundamentalsPanel } from './FundamentalsPanel'

describe('재무 탭', () => {
  it('지표 열 개와 근거(분기·공시일)를 보여준다', () => {
    render(<FundamentalsPanel data={FUNDAMENTALS} />)
    for (const label of ['PER', 'PBR', '배당수익률', 'ROE', '영업이익률', '부채비율', 'FCF (최근 1년)']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    expect(screen.getByText('28.1배')).toBeInTheDocument()
    const perBox = screen.getByText('28.1배').closest('.stat-box')!
    expect(perBox).toHaveTextContent('2026.06까지 · 공시 2026-07-23')
    // 날짜 한 덩어리는 가운데서 끊기지 않게 조각으로 나뉘어 있다
    expect(within(perBox as HTMLElement).getByText(/공시 2026-07-23/)).toHaveClass('nobr')
    expect(screen.getByText(/2026-09-25 종가 \$245\.50로 계산/)).toBeInTheDocument()
  })

  it('PER 5년 위치를 사실로 적는다', () => {
    render(<FundamentalsPanel data={FUNDAMENTALS} />)
    expect(screen.getByText(/PER이 지금\(28\.1배\) 이하였던 날은 71%/)).toBeInTheDocument()
    expect(screen.getByText('최저 16.2')).toBeInTheDocument()
    expect(screen.getByText('최고 34.8')).toBeInTheDocument()
  })

  it('분기 표 — 결산월, 처음 공시된 날, 정정 표시, 빈칸은 —', () => {
    render(<FundamentalsPanel data={FUNDAMENTALS} />)
    const table = screen.getByRole('table')
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByText('2026.06')).toBeInTheDocument()
    expect(within(rows[0]).getByText(/공시 2026-07-23/)).toBeInTheDocument()
    expect(within(rows[0]).getByText('$119.8B')).toBeInTheDocument()
    expect(within(rows[0]).getByText('$9.11')).toBeInTheDocument()
    expect(within(rows[0]).getAllByText('—').length).toBeGreaterThan(0)
    expect(within(rows[1]).getByText(/정정됨/)).toBeInTheDocument()
    // 폰에서 칸 이름을 붙이는 데 쓴다
    expect(within(rows[0]).getByText('$119.8B').closest('td')).toHaveAttribute('data-label', '매출')
  })

  it('공시에 없는 항목을 알려준다', () => {
    render(<FundamentalsPanel data={FUNDAMENTALS} />)
    expect(screen.getByText(/공시에 없는 항목: 설비투자/)).toBeInTheDocument()
  })

  it('아직 못 받았거나 못 읽는 종목은 이유만', () => {
    const { rerender } = render(
      <FundamentalsPanel data={{ ...FUNDAMENTALS, state: null, message: null, metrics: [], quarters: [], per_range: null }} />,
    )
    expect(screen.getByText(/아직 재무를 받지 않았습니다/)).toBeInTheDocument()
    rerender(
      <FundamentalsPanel
        data={{
          ...FUNDAMENTALS,
          state: 'unsupported',
          message: '해외 발행사(20-F)는 연간 값만, 자국 통화로 공시해 분기 표를 만들 수 없습니다',
          metrics: [],
          quarters: [],
          per_range: null,
        }}
      />,
    )
    expect(screen.getByText(/해외 발행사/)).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('판단하는 말을 쓰지 않는다', () => {
    const { container } = render(<FundamentalsPanel data={FUNDAMENTALS} />)
    expect(container.textContent).not.toMatch(/저평가|고평가|싸다|비싸다|양호|위험|매수|매도/)
  })
})
