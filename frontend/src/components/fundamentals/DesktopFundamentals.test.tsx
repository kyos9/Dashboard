import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../api/client'
import { FUNDAMENTALS } from '../../test/fundamentalsFixture'
import type { FundamentalsResponse } from '../../types'
import { growth, quarterName } from '../../lib/fundamentals'
import { DesktopFundamentals } from './DesktopFundamentals'

const GOOG: FundamentalsResponse = {
  ...FUNDAMENTALS,
  name: 'Alphabet',
  per_range: { ...FUNDAMENTALS.per_range!, mean: 22.5 },
}
const ETF: FundamentalsResponse = {
  ...FUNDAMENTALS,
  ticker: 'VOO',
  name: null,
  state: 'none',
  message: '재무제표가 없는 종목입니다 (ETF·펀드 등)',
  metrics: [],
  per_range: null,
  quarters: [],
}

function Harness({ rows }: { rows: FundamentalsResponse[] }) {
  const [selected, setSelected] = useState<string | null>(null)
  return <DesktopFundamentals rows={rows} selected={selected} onSelect={setSelected} />
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('PC 재무 화면 (디자인 5차)', () => {
  it('왼쪽은 종목명만, 재무가 없는 종목은 아래 따로', () => {
    render(<Harness rows={[GOOG, ETF]} />)
    const list = screen.getByRole('listbox', { name: '종목' })
    const options = within(list).getAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual(['GOOG', 'VOO'])
    expect(within(list).getByText('재무가 없는 종목')).toBeInTheDocument()
    expect(options[0]).toHaveAttribute('aria-selected', 'true')
  })

  it('오른쪽: 카드 다섯(PER · 가치 · 수익성 · 성장 · 안정) — PER 카드에 지금, 5년 평균, 그 밑 범위, 차이', () => {
    render(<Harness rows={[GOOG, ETF]} />)
    const detail = screen.getByRole('article')
    for (const t of ['PER', '가치', '수익성', '성장', '안정']) expect(within(detail).getByRole('region', { name: t })).toBeInTheDocument()
    const per = within(detail).getByRole('region', { name: 'PER' })
    const lines = within(per).getAllByRole('listitem').map((li) => li.textContent)
    expect(lines).toEqual(['지금28.1배', '5년 평균22.5배', '5년 범위16.2 ~ 34.8배', '평균과 차이+25%'])
    expect(per).not.toHaveTextContent('위치')
    // PER 은 가치 카드에서 빠진다
    expect(within(detail).getByRole('region', { name: '가치' })).not.toHaveTextContent('PER')
  })

  it('실적: 분기는 전분기비만, 회사 가이던스는 분기에만', async () => {
    render(<Harness rows={[GOOG, ETF]} />)
    const table = within(screen.getByRole('region', { name: '실적' })).getByRole('table')
    const first = within(table).getAllByRole('row')[1]
    expect(within(first).getByRole('rowheader')).toHaveTextContent('2026년 2분기')
    const revenue = within(first).getAllByRole('cell')[0]
    expect(revenue).toHaveTextContent('전분기 +9.0%') // 119.8B ÷ 109.9B
    expect(revenue).not.toHaveTextContent('전년')
    const results = screen.getByRole('region', { name: '실적' })
    expect(within(results).getByLabelText('회사 가이던스')).toHaveTextContent('아직 모으지 않습니다')
    await userEvent.click(screen.getByRole('button', { name: '연' }))
    expect(within(results).queryByLabelText('회사 가이던스')).toBeNull()
  })

  it('실적: 연으로 바꾸면 최신 분기까지 1년씩, 전년비만', async () => {
    const year = (end: string, revenue: number) => ({ ...FUNDAMENTALS.quarters[0], period_end: end, filed_at: '2026-07-30', revenue })
    const withYears = { ...GOOG, years: [year('2026-06-30', 120), year('2025-06-30', 100)] }
    render(<Harness rows={[withYears]} />)
    await userEvent.click(screen.getByRole('button', { name: '연' }))
    expect(screen.getByRole('button', { name: '연' })).toHaveAttribute('aria-pressed', 'true')
    const table = within(screen.getByRole('region', { name: '실적' })).getByRole('table')
    const first = within(table).getAllByRole('row')[1]
    expect(within(first).getByRole('rowheader')).toHaveTextContent('25년 3분기 ~ 26년 2분기공시 7월 30일')
    const revenue = within(first).getAllByRole('cell')[0]
    expect(revenue).toHaveTextContent('전년 +20.0%')
    expect(revenue).not.toHaveTextContent('전분기')
  })

  it('목록 응답에 분기가 없으면 그 종목만 따로 받는다', async () => {
    const spy = vi.spyOn(api, 'getFundamentals').mockResolvedValue({ ...GOOG, ticker: 'MSFT2' })
    render(<Harness rows={[{ ...GOOG, ticker: 'MSFT2', name: 'Microsoft', quarters: [] }]} />)
    expect(screen.getByText('실적을 받는 중입니다.')).toBeInTheDocument()
    expect(await screen.findByText('2026년 2분기')).toBeInTheDocument()
    expect(spy).toHaveBeenCalledWith('MSFT2')
  })

  it('재무가 없는 종목을 고르면 이유', async () => {
    render(<Harness rows={[GOOG, ETF]} />)
    await userEvent.click(screen.getByRole('button', { name: 'VOO' }))
    expect(screen.getByRole('article')).toHaveTextContent('재무제표가 없는 종목입니다')
  })

  it('도우미: 분기 이름, 늘어난 비율', () => {
    expect(quarterName('2026-09-30')).toBe('2026년 3분기')
    expect(quarterName('2025-12-31')).toBe('2025년 4분기')
    expect(growth(110, 100)).toBeCloseTo(10)
    expect(growth(5, -2)).toBeNull()
    expect(growth(null, 3)).toBeNull()
  })
})
