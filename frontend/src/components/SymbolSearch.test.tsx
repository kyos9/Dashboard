import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../api/client'
import type { SymbolMatch } from '../types'
import { SymbolSearch } from './SymbolSearch'

const SAMSUNG: SymbolMatch = {
  ticker: '005930.KS',
  name: '삼성전자',
  market: 'KR',
  board: 'KOSPI',
  instrument: 'STOCK',
  source: 'seed',
  confident: true,
}

const ECOPRO: SymbolMatch = {
  ticker: '247540.KQ',
  name: '에코프로비엠',
  market: 'KR',
  board: 'KOSDAQ',
  instrument: 'STOCK',
  source: 'krx',
  confident: true,
}

function setup(matches: SymbolMatch[] = [SAMSUNG, ECOPRO], selected: SymbolMatch | null = null) {
  const onSelect = vi.fn()
  const onSubmitRaw = vi.fn()
  vi.spyOn(api, 'searchSymbols').mockResolvedValue(matches)
  const user = userEvent.setup()
  render(
    <SymbolSearch selected={selected} onSelect={onSelect} onSubmitRaw={onSubmitRaw} />,
  )
  return { user, onSelect, onSubmitRaw }
}

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('종목 검색', () => {
  it('입력하면 후보를 보여준다', async () => {
    const { user } = setup()
    await user.type(screen.getByRole('combobox'), '삼성')

    expect(await screen.findByText('삼성전자')).toBeInTheDocument()
    expect(screen.getByText(/005930\.KS · 코스피/)).toBeInTheDocument()
  })

  it('후보마다 출처를 밝힌다 — 내장 목록은 최신이 아닐 수 있으므로', async () => {
    const { user } = setup()
    await user.type(screen.getByRole('combobox'), '삼성')

    expect(await screen.findByText(/내장 목록/)).toBeInTheDocument()
    expect(screen.getByText(/거래소 목록/)).toBeInTheDocument()
  })

  it('타이핑마다 요청하지 않는다 (디바운스)', async () => {
    const { user } = setup()
    const spy = vi.mocked(api.searchSymbols)

    await user.type(screen.getByRole('combobox'), '삼성전자')
    await waitFor(() => expect(spy).toHaveBeenCalled())

    // 5글자를 쳤지만 요청은 훨씬 적어야 한다
    expect(spy.mock.calls.length).toBeLessThan(4)
  })

  it('후보를 고르면 부모에 알린다', async () => {
    const { user, onSelect } = setup()
    await user.type(screen.getByRole('combobox'), '삼성')
    await user.click(await screen.findByText('삼성전자'))

    expect(onSelect).toHaveBeenCalledWith(SAMSUNG)
  })

  it('키보드로 고를 수 있다', async () => {
    const { user, onSelect } = setup()
    const input = screen.getByRole('combobox')
    await user.type(input, '삼성')
    await screen.findByText('삼성전자')

    await user.keyboard('{ArrowDown}{Enter}')
    // 첫 후보(0)에서 한 칸 내려갔으므로 두 번째가 선택된다
    expect(onSelect).toHaveBeenCalledWith(ECOPRO)
  })

  it('후보를 고르지 않고 엔터를 치면 입력값 그대로 서버에 맡긴다', async () => {
    const { user, onSubmitRaw } = setup([])
    await user.type(screen.getByRole('combobox'), 'VOO{Enter}')

    expect(onSubmitRaw).toHaveBeenCalledWith('VOO')
  })

  it('Escape로 후보 목록을 닫는다', async () => {
    const { user } = setup()
    await user.type(screen.getByRole('combobox'), '삼성')
    await screen.findByText('삼성전자')

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
  })

  it('시장이 확정되지 않은 후보는 확인이 필요하다고 표시한다', async () => {
    const { user } = setup([
      { ...SAMSUNG, ticker: '999999.KS', name: '999999 (KOSPI)', source: 'guess', confident: false },
    ])
    await user.type(screen.getByRole('combobox'), '999999')

    expect(await screen.findByText('시장 확인 필요')).toBeInTheDocument()
  })

  it('후보가 없으면 다음에 할 일을 알려준다', async () => {
    const { user } = setup([])
    await user.type(screen.getByRole('combobox'), '없는회사')

    expect(await screen.findByText(/거래소 목록 갱신/)).toBeInTheDocument()
  })

  it('검색이 실패해도 화면이 죽지 않는다', async () => {
    vi.spyOn(api, 'searchSymbols').mockRejectedValue(new Error('네트워크 차단'))
    const user = userEvent.setup()
    render(<SymbolSearch selected={null} onSelect={vi.fn()} onSubmitRaw={vi.fn()} />)

    await user.type(screen.getByRole('combobox'), '삼성')
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
    expect(screen.getByRole('combobox')).toBeInTheDocument()
  })
})

describe('고른 뒤', () => {
  it('무엇이 등록될지 티커와 시장까지 보여준다', () => {
    setup([], SAMSUNG)

    expect(screen.getByText('삼성전자')).toBeInTheDocument()
    expect(screen.getByText(/005930\.KS · 코스피/)).toBeInTheDocument()
    // 검색창 대신 확인용 표시로 바뀐다
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('ETF는 그렇다고 표시한다', () => {
    setup([], { ...SAMSUNG, ticker: '069500.KS', name: 'KODEX 200', instrument: 'ETF' })
    expect(screen.getByText(/ETF/)).toBeInTheDocument()
  })

  it('변경을 누르면 다시 검색할 수 있다', async () => {
    const { user, onSelect } = setup([], SAMSUNG)
    await user.click(screen.getByRole('button', { name: '변경' }))
    expect(onSelect).toHaveBeenCalledWith(null)
  })
})
