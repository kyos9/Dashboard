import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import { useBackToClose } from '../lib/backToClose'
import { CURRENCY_META } from '../lib/display'
import { fxFromInput, fxToInput, fxUnitLabel } from '../lib/fxInput'
import type { Currency } from '../types'
import { ErrorNotice } from './ErrorNotice'
import { NumberInput } from './NumberInput'

export interface HoldingTarget {
  ticker: string
  /** 화면에 보일 이름 (국내는 종목명, 해외는 티커) */
  label: string
  currency: Currency
  quantity: number
  avgCost: number | null
  avgFx?: number | null
}

interface Props {
  target: HoldingTarget
  /** 처음 커서를 둘 칸. "평단가 입력"으로 열면 평단가 */
  focus?: 'quantity' | 'avgCost'
  onClose: () => void
  onSaved: () => void
}

/** 저장된 숫자 → 칸의 글자. 비어 있으면 빈칸 */
function toInput(value: number | null | undefined): string {
  if (value === null || value === undefined) return ''
  return String(Number(value.toFixed(8)))
}

/**
 * 보유 수량 · 평단가 · 산 환율 고치기 (ROADMAP 9-1).
 *
 * 전에는 리밸런싱 탭의 보유 표에서만 고칠 수 있었다. 대시보드와 종목 관리에서도 같은 팝업으로
 * 고친다. 저장하는 곳은 셋 다 같은 `PUT /api/rebalance/holdings/{ticker}` 라 어느 화면에서
 * 고쳐도 나머지 화면이 같은 값을 본다.
 *
 * - 수량을 비우면 0 — "관심 종목"으로 내려간다.
 * - 평단가를 비우면 모름 — 손익만 비고 비중은 그대로다.
 * - 산 환율은 **고쳤을 때만** 보낸다. 엔은 100엔 단위로 받아 되돌리므로 안 고친 값도 끝자리가
 *   흔들린다(리밸런싱 탭과 같은 규칙).
 */
export function HoldingEditModal({ target, focus = 'quantity', onClose, onSaved }: Props) {
  const foreign = target.currency !== 'KRW'
  const initialFx = fxToInput(target.avgFx, target.currency)
  const [quantity, setQuantity] = useState(toInput(target.quantity || null))
  const [avgCost, setAvgCost] = useState(toInput(target.avgCost))
  const [avgFx, setAvgFx] = useState(initialFx)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const quantityRef = useRef<HTMLLabelElement>(null)
  const costRef = useRef<HTMLLabelElement>(null)

  useEffect(() => {
    const box = focus === 'avgCost' ? costRef.current : quantityRef.current
    box?.querySelector('input')?.focus()
  }, [focus])

  useBackToClose(onClose, !busy)

  // ESC로 닫기 + 뒤 화면이 같이 스크롤되지 않게 (다른 팝업과 같은 규칙)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    document.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [busy, onClose])

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      await api.updateHolding(
        target.ticker,
        Number(quantity || 0),
        avgCost === '' ? null : Number(avgCost),
        foreign && avgFx !== initialFx ? fxFromInput(avgFx, target.currency) : undefined,
      )
      onSaved()
      onClose()
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }

  const title = `${target.label} 보유 수정`
  return (
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <div
        className="modal confirm-modal holding-edit"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div className="modal-title">
            <h3>{title}</h3>
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <div className="holding-edit-fields">
            <label className="field" ref={quantityRef}>
              <span>보유 수량</span>
              <span className="input-with-button tight">
                <NumberInput
                  value={quantity}
                  onChange={setQuantity}
                  placeholder="0"
                  aria-label={`${target.label} 보유수량`}
                />
                <span className="unit">주</span>
              </span>
            </label>
            <label className="field" ref={costRef}>
              <span>평단가 ({CURRENCY_META[target.currency].label})</span>
              <span className="input-with-button tight">
                <span className="unit">{CURRENCY_META[target.currency].symbol}</span>
                <NumberInput
                  value={avgCost}
                  onChange={setAvgCost}
                  placeholder="모름"
                  aria-label={`${target.label} 평단가`}
                />
              </span>
            </label>
            {foreign && (
              <label className="field">
                <span>산 환율</span>
                <span className="input-with-button tight">
                  <NumberInput
                    value={avgFx}
                    onChange={setAvgFx}
                    placeholder="모름"
                    aria-label={`${target.label} 산 환율`}
                  />
                  <span className="unit">{fxUnitLabel(target.currency)}</span>
                </span>
              </label>
            )}
          </div>
          <p className="hint">
            수량을 비우면 0 — 관심 종목으로 내려갑니다. 평단가를 비우면 손익만 비고 비중은 그대로입니다.
            {foreign && ' 산 환율은 환율 효과를 켰을 때 손익에 씁니다.'}
          </p>
          <ErrorNotice error={error} />
          <div className="btn-group confirm-actions">
            <button type="button" disabled={busy} onClick={onClose}>
              취소
            </button>
            <button type="submit" className="primary" disabled={busy}>
              {busy ? '저장 중…' : '저장'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
