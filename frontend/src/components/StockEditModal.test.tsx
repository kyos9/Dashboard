import { act, cleanup, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../api/client'
import { resetBackToClose } from '../lib/backToClose'
import { resetScrollLock } from '../lib/scrollLock'
import type { Stock } from '../types'
import { StockEditModal } from './StockEditModal'

/** 종목 한 번에 수정 — 저장 안 한 것이 있을 때 닫기·뒤로가기, 저장 실패 (0.45.0 D6) */

function stock(ticker: string): Stock {
  return {
    ticker,
    name: null,
    category: null,
    market: 'US',
    currency: 'USD',
    active: true,
    added_at: '2026-01-01T00:00:00',
    target_weight_pct: 50,
    rebalance_band_pct: null,
    sort_order: 0,
  }
}

const STOCKS = [stock('VOO'), stock('QQQ')]
const HOLDINGS = new Map([
  ['VOO', { quantity: 1, avg_cost: null }],
  ['QQQ', { quantity: 2, avg_cost: null }],
])

/**
 * 뒤로가기 한 번 — popstate 가 온 뒤, 닫힌 팝업의 칸을 치우는 다음 박자까지 기다린다. 고정 30ms 만 기다리면 부하가 걸린
 * 날(테스트를 여럿 같이 돌릴 때) 그 박자와 겹쳐 가끔 넘어졌다(D 두 번째 검토).
 */
async function back() {
  await act(async () => {
    await new Promise<void>((resolve) => {
      window.addEventListener('popstate', () => resolve(), { once: true })
      window.history.back()
    })
    await new Promise((r) => setTimeout(r, 30))
  })
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30))
  })
}

function open() {
  const onClose = vi.fn()
  const onSaved = vi.fn()
  render(<StockEditModal stocks={STOCKS} holdings={HOLDINGS} onClose={onClose} onSaved={onSaved} />)
  return { onClose, onSaved, dialog: screen.getByRole('dialog', { name: '종목 한 번에 수정' }) }
}

async function editQuantity(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, ticker: string, value: string) {
  const box = within(dialog).getByRole('textbox', { name: `${ticker} 보유수량` })
  await user.clear(box)
  await user.type(box, value)
}

beforeEach(() => {
  vi.restoreAllMocks()
  resetBackToClose()
  resetScrollLock()
  document.body.style.overflow = ''
  window.history.replaceState(null, '', '/stocks')
})

afterEach(async () => {
  cleanup()
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30))
  })
})

describe('저장 안 한 것이 있으면 닫기 전에 묻는다', () => {
  it('고친 것이 없으면 뒤로가기·취소는 그대로 닫는다 (전과 같다)', async () => {
    const { onClose } = open()
    await back()
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('폰 뒤로가기 — 닫지 않고 몇 종목이 남았는지 묻는다, "계속 고치기"면 그대로', async () => {
    const user = userEvent.setup()
    const { onClose, dialog } = open()
    await editQuantity(user, dialog, 'QQQ', '3')

    await back()
    expect(onClose).not.toHaveBeenCalled()
    const ask = screen.getByRole('alertdialog', { name: '저장하지 않고 닫을까요?' })
    expect(ask).toHaveTextContent('저장하지 않은 종목 1개(QQQ)가 있습니다')
    // 처음 커서는 머무는 쪽
    expect(within(ask).getByRole('button', { name: '계속 고치기' })).toHaveFocus()

    await user.click(within(ask).getByRole('button', { name: '계속 고치기' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(within(dialog).getByRole('textbox', { name: 'QQQ 보유수량' })).toHaveValue('3')
    expect(onClose).not.toHaveBeenCalled()

    // 한 번 더 뒤로가기 — 또 묻는다(칸이 다시 쌓여 있다), 이번엔 확인 창의 뒤로가기는 "계속 고치기"
    await back()
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    await back()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('"버리고 닫기"면 닫는다', async () => {
    const user = userEvent.setup()
    const { onClose, dialog } = open()
    await editQuantity(user, dialog, 'VOO', '5')
    await back()
    await user.click(screen.getByRole('button', { name: '버리고 닫기' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('취소 단추·✕ 도 같이 묻는다', async () => {
    const user = userEvent.setup()
    const { onClose, dialog } = open()
    await editQuantity(user, dialog, 'VOO', '5')

    await user.click(within(dialog).getByRole('button', { name: '취소' }))
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '계속 고치기' }))

    await user.click(within(dialog).getByRole('button', { name: '닫기' }))
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('저장에 실패하면', () => {
  it('첫 실패 줄로 옮기고, 늘 보이는 안내를 접는다 — 폰에서 아래 칸이 그 줄을 가렸다', async () => {
    const scrolled: string[] = []
    const original = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push((this as HTMLElement).dataset.ticker ?? '')
    }
    try {
      vi.spyOn(api, 'updateHolding').mockImplementation((ticker: string) =>
        ticker === 'QQQ' ? Promise.reject(new Error('down')) : Promise.resolve({} as never),
      )
      const user = userEvent.setup()
      const { dialog, onClose } = open()
      expect(within(dialog).getByText(/수량을 비우면 0/)).toBeInTheDocument()
      scrolled.length = 0
      await editQuantity(user, dialog, 'VOO', '5')
      await editQuantity(user, dialog, 'QQQ', '6')
      await user.click(within(dialog).getByRole('button', { name: '2종목 저장' }))

      expect(await within(dialog).findByText(/저장하지 못한 종목: QQQ/)).toBeInTheDocument()
      expect(scrolled).toEqual(['QQQ'])
      expect(within(dialog).queryByText(/수량을 비우면 0/)).not.toBeInTheDocument()
      expect(onClose).not.toHaveBeenCalled()

      // 실패한 것만 남는다 — 닫으려 하면 그 하나를 말한다
      await back()
      expect(screen.getByRole('alertdialog')).toHaveTextContent('저장하지 않은 종목 1개(QQQ)')
    } finally {
      Element.prototype.scrollIntoView = original
    }
  })
})

describe('닫은 뒤 뒤 화면이 다시 스크롤된다 (D 검토 — "버리고 닫기" 뒤 앱 전체가 멈춰 있었다)', () => {
  /** 진짜 화면처럼 부모가 시트를 지운다 — onClose 를 가짜로 두면 시트와 확인 창이 같은 박자에 사라지는 길을 못 본다 */
  function Host() {
    const [open, setOpen] = useState(true)
    return open ? <StockEditModal stocks={STOCKS} holdings={HOLDINGS} onClose={() => setOpen(false)} onSaved={() => {}} /> : <p>닫힘</p>
  }

  it.each([
    ['✕', async (user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement) => user.click(within(dialog).getByRole('button', { name: '닫기' }))],
    ['취소', async (user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement) => user.click(within(dialog).getByRole('button', { name: '취소' }))],
    ['뒤로가기', async () => back()],
  ])('%s → 버리고 닫기', async (_name, ask) => {
    const user = userEvent.setup()
    render(<Host />)
    const dialog = screen.getByRole('dialog', { name: '종목 한 번에 수정' })
    expect(document.body.style.overflow).toBe('hidden')
    await editQuantity(user, dialog, 'VOO', '5')
    await ask(user, dialog)
    await user.click(screen.getByRole('button', { name: '버리고 닫기' }))
    expect(screen.getByText('닫힘')).toBeInTheDocument()
    expect(document.body.style.overflow).toBe('')
  })

  it('고친 것이 없을 때 닫아도', async () => {
    render(<Host />)
    await back()
    expect(screen.getByText('닫힘')).toBeInTheDocument()
    expect(document.body.style.overflow).toBe('')
  })
})

it('여러 종목이 실패하면 **첫** 실패 줄로', async () => {
  const scrolled: string[] = []
  const original = Element.prototype.scrollIntoView
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push((this as HTMLElement).dataset.ticker ?? '')
  }
  try {
    vi.spyOn(api, 'updateHolding').mockRejectedValue(new Error('down'))
    const user = userEvent.setup()
    const { dialog } = open()
    scrolled.length = 0
    await editQuantity(user, dialog, 'VOO', '5')
    await editQuantity(user, dialog, 'QQQ', '6')
    await user.click(within(dialog).getByRole('button', { name: '2종목 저장' }))
    expect(await within(dialog).findByText(/저장하지 못한 종목: VOO, QQQ/)).toBeInTheDocument()
    expect(scrolled).toEqual(['VOO'])
  } finally {
    Element.prototype.scrollIntoView = original
  }
})

describe('보유 수량에 빼기 (0.45.2 A2)', () => {
  it('"-3" 에는 보유 수량이 합계라는 한 마디가 붙고, 평단가에는 없다', async () => {
    const user = userEvent.setup()
    const { dialog } = open()
    const live = () => document.querySelector('[data-num-live]')
    await editQuantity(user, dialog, 'VOO', '-3')
    expect(live()).toHaveTextContent('VOO 보유수량 — 빼기(−)는 넣을 수 없습니다 · 지금 값 3 · 보유 수량은 가진 전체 수량입니다(판 수량이 아닙니다)')
    await user.type(within(dialog).getByRole('textbox', { name: 'VOO 평단가' }), '-')
    expect(live()).not.toHaveTextContent('판 수량')
  })
})
