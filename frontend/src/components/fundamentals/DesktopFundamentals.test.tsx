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

  it('오른쪽: 묶음 카드 넷, PER 지금 · 5년 평균 · 차이 (5년 중 위치는 없음)', () => {
    render(<Harness rows={[GOOG, ETF]} />)
    const detail = screen.getByRole('article')
    for (const t of ['가치', '수익성', '성장', '안정']) expect(within(detail).getByRole('region', { name: t })).toBeInTheDocument()
    const per = within(detail).getByRole('region', { name: 'PER' })
    expect(per).toHaveTextContent('지금 PER28.1배')
    expect(per).toHaveTextContent('5년 평균 PER22.5배')
    expect(per).toHaveTextContent('+25%') // 28.14 ÷ 22.5
    expect(per).not.toHaveTextContent('위치')
    expect(within(detail).getByText('회사 가이던스는 아직 모으지 않습니다.')).toBeInTheDocument()
  })

  it('최근 분기에 전년비 · 전분기비 — 1년 전 분기가 없으면 —', () => {
    render(<Harness rows={[GOOG, ETF]} />)
    const table = within(screen.getByRole('region', { name: '최근 분기' })).getByRole('table')
    const first = within(table).getAllByRole('row')[1]
    expect(within(first).getByRole('rowheader')).toHaveTextContent('2026년 2분기')
    const revenue = within(first).getAllByRole('cell')[0]
    expect(revenue).toHaveTextContent('전분기 +9.0%') // 119.8B ÷ 109.9B
    expect(revenue).toHaveTextContent('전년 —')
  })

  it('목록 응답에 분기가 없으면 그 종목만 따로 받는다', async () => {
    const spy = vi.spyOn(api, 'getFundamentals').mockResolvedValue({ ...GOOG, ticker: 'MSFT2' })
    render(<Harness rows={[{ ...GOOG, ticker: 'MSFT2', name: 'Microsoft', quarters: [] }]} />)
    expect(screen.getByText('분기 실적을 받는 중입니다.')).toBeInTheDocument()
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
