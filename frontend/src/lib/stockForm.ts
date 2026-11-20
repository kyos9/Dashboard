/** 새 종목 입력칸. 숫자도 글자로 들고 있다 — 비워둔 것과 0을 구분해야 한다 */
export interface NewStockForm {
  ticker: string
  category: string
  targetWeight: string
  quantity: string
  avgCost: string
  /** 산 환율 — 달러는 원/$, 엔은 원/100엔으로 받는다 */
  avgFx: string
}

export const emptyForm: NewStockForm = { ticker: '', category: '', targetWeight: '', quantity: '', avgCost: '', avgFx: '' }
