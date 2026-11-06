import { useEffect, useRef, type ReactNode } from 'react'
import { useBackToClose } from '../../lib/backToClose'
import { lockBodyScroll } from '../../lib/scrollLock'
import { useFocusTrap } from '../../lib/focusTrap'
import { HOLDING_MINUS_HINT } from '../../lib/numberDropped'
import { fxUnitLabel } from '../../lib/fxInput'
import type { Currency } from '../../types'
import { NumberInput } from '../NumberInput'
import type { NewStockForm } from '../../lib/stockForm'

/** 구분 입력을 돕는 예시값 — 자유 입력이므로 강제되지 않는다 */
const CATEGORY_SUGGESTIONS = ['지수', '알파', '안전자산']

interface Props {
  /** 시트 제목에 쓰는 이름 ("삼성SDI") */
  title: string
  /** 이름 아래 한 줄 ("006400.KS · 한국 · 원") */
  sub?: ReactNode
  form: NewStockForm
  onChange: (next: NewStockForm) => void
  /** 고른 종목의 통화 — 고르지 않고 쳐서 넣으면 모른다(단위를 붙이지 않는다, 0.44.0 C3) */
  currency: Currency | null
  /** 평단가 단위 기호·통화 이름 */
  currencySymbol: string | null
  currencyLabel: string | null
  busy: boolean
  onSubmit: () => void
  onClose: () => void
}

/**
 * 종목 추가 바텀 시트 (디자인 4차 목업 11 — 찾기 칸에서 고르면 아래에서 올라온다).
 * 보이기만 한다 — 입력값과 추가는 종목 탭(StockManager)이 그대로 들고 있다.
 * 목표 비중만 넣어도 담기고, 수량·평단가는 비워 두면 보내지 않는다(관심 종목).
 */
export function AddStockSheet({ title, sub, form, onChange, currency, currencySymbol, currencyLabel, busy, onSubmit, onClose }: Props) {
  useBackToClose(onClose)
  const ref = useRef<HTMLDivElement>(null)
  // Tab 은 시트 안에서만 돈다(검토 조건 3). 첫 칸(구분)이 아니라 목표 비중에 — 구분은 비워 둬도 되고, 목표가 가장 자주 넣는 값이다.
  // 닫으면 연 자리(찾기 칸·후보)로 돌아간다
  useFocusTrap(ref, () => ref.current?.querySelector<HTMLInputElement>('#new-weight'))
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    const release = lockBodyScroll()
    return () => {
      document.removeEventListener('keydown', onKey)
      release()
    }
  }, [onClose])

  const foreign = currency !== null && currency !== 'KRW'
  return (
    <div className="modal-backdrop sheet-backdrop" onClick={onClose}>
      <div
        ref={ref}
        className="sheet add-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={`${title} 추가`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-grab" aria-hidden="true" />
        <div className="sheet-head">
          <div>
            <h3>{title} 추가</h3>
            {sub && <p className="hint">{sub}</p>}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="추가 닫기">
            ✕
          </button>
        </div>
        <datalist id="category-options">
          {CATEGORY_SUGGESTIONS.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <form
          className="add-sheet-form"
          onSubmit={(e) => {
            e.preventDefault()
            onSubmit()
          }}
        >
          <div className="field">
            <label htmlFor="new-category">구분</label>
            <input
              id="new-category"
              type="text"
              list="category-options"
              // 회색 "지수"가 미리 채운 값으로 읽혔다(사용자 확인) — 고를 말은 목록(datalist)이 보여 준다 (0.44.0 C3)
              placeholder="비워 둬도 됩니다"
              value={form.category}
              onChange={(e) => onChange({ ...form, category: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="new-weight">목표 비중 (%)</label>
            <NumberInput id="new-weight" placeholder="0" value={form.targetWeight} onChange={(v) => onChange({ ...form, targetWeight: v })} />
            {/* 담자마자 "전부 파는 계산" 경고가 떠 놀랐다 — 넣기 전에 같은 말을 한 줄 (사용자 확인 헷갈린 말 4) */}
            {form.targetWeight === '' && form.quantity !== '' && Number(form.quantity) > 0 && (
              <p className="hint add-sheet-warn">비워 두면 0% — 리밸런싱에서 이 종목을 전부 파는 계산이 됩니다.</p>
            )}
          </div>
          <div className="add-sheet-two">
            <div className="field">
              <label htmlFor="new-quantity">보유 수량</label>
              <NumberInput
                id="new-quantity"
                placeholder="없으면 비움"
                minusHint={HOLDING_MINUS_HINT}
                value={form.quantity}
                onChange={(v) => onChange({ ...form, quantity: v })}
              />
            </div>
            <div className="field">
              <label htmlFor="new-cost">평단가{currencySymbol ? ` (${currencySymbol})` : ''}</label>
              <NumberInput id="new-cost" placeholder="모르면 비움" value={form.avgCost} onChange={(v) => onChange({ ...form, avgCost: v })} />
            </div>
          </div>
          {/* 산 환율은 목록에서 고른 외화 종목만 — 이름을 쳐서 넣으면 원화 종목일 수도 있다 (그러면 서버가 거절한다) */}
          {foreign && (
            <div className="field">
              <label htmlFor="new-fx">산 환율 ({fxUnitLabel(currency)})</label>
              <NumberInput id="new-fx" placeholder="모르면 비움" value={form.avgFx} onChange={(v) => onChange({ ...form, avgFx: v })} />
            </div>
          )}
          <button type="submit" className="primary add-sheet-submit" disabled={busy}>
            {busy ? '추가하는 중…' : '종목 추가'}
          </button>
        </form>
        <p className="hint add-sheet-hint">
          목표 비중은 <b>현금을 포함한 전체 자금</b> 중 이 종목의 비중입니다. 이미 들고 있으면 수량·평단가도 적으세요 — 평단가(
          {currencyLabel ? `${currencyLabel} 기준` : '그 종목을 거래하는 통화 기준'})는 손익에만 쓰이고 비중에는 영향이 없습니다. 둘 다
          나중에 종목 안의 "보유"에서 고칠 수 있습니다. 시세를 못 받아도 종목은 남고 나중에 다시 받습니다.
        </p>
      </div>
    </div>
  )
}
