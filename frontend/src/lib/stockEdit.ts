/**
 * 종목 한 번에 수정의 칸 (ROADMAP 9-11) — 저장된 값과 칸의 글자를 오가고, 무엇이 바뀌었는지 가린다.
 */
import type { Stock } from '../types'
import { fxToInput } from './fxInput'

/** 한 종목의 보유 — 대시보드는 리밸런싱 응답에서, 종목 관리는 보유 목록에서 온다 */
export interface HoldingValues {
  quantity: number
  avg_cost: number | null
  avg_fx?: number | null
}

export type EditField = 'quantity' | 'avgCost'

/** 칸마다 글자로 들고 있다 — 비워 둔 것과 0을 구분해야 한다 */
export interface EditDraft {
  name: string
  category: string
  target: string
  band: string
  quantity: string
  avgCost: string
  avgFx: string
}

/** 저장된 숫자 → 칸의 글자. 소수 끝자리 잡음은 뗀다 */
function toInput(value: number | null | undefined): string {
  if (value === null || value === undefined) return ''
  return String(Number(value.toFixed(8)))
}

export function draftOf(stock: Stock, holding: HoldingValues | undefined): EditDraft {
  return {
    name: stock.name ?? '',
    category: stock.category ?? '',
    target: toInput(stock.target_weight_pct),
    band: toInput(stock.rebalance_band_pct),
    quantity: toInput(holding?.quantity || null),
    avgCost: toInput(holding?.avg_cost),
    avgFx: fxToInput(holding?.avg_fx, stock.currency),
  }
}

/** 구분 칸의 흔한 예시 — 자유 입력이라 강제하지 않는다 */
export const CATEGORY_SUGGESTIONS = ['지수', '알파', '안전자산']

const STOCK_FIELDS = ['name', 'category', 'target', 'band'] as const
const HOLDING_FIELDS = ['quantity', 'avgCost', 'avgFx'] as const

/** 무엇이 바뀌었나 — 처음 연 값과 글자로 견준다(숫자로 되돌려 견주면 소수 잡음에 흔들린다) */
export function changesOf(before: EditDraft, after: EditDraft): { stock: boolean; holding: boolean } {
  return {
    stock: STOCK_FIELDS.some((key) => before[key].trim() !== after[key].trim()),
    holding: HOLDING_FIELDS.some((key) => before[key].trim() !== after[key].trim()),
  }
}

