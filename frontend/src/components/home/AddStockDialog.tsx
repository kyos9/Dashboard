import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, api } from '../../api/client'
import { SymbolSearch } from '../SymbolSearch'
import { AddStockSheet } from '../stock/AddStockSheet'
import { emptyForm, type NewStockForm } from '../../lib/stockForm'
import { CURRENCY_BY_MARKET, CURRENCY_META, MARKET_LABEL, stockLabel } from '../../lib/display'
import { fxFromInput } from '../../lib/fxInput'
import { useFocusTrap } from '../../lib/focusTrap'
import { useBackToClose } from '../../lib/backToClose'
import { lockBodyScroll } from '../../lib/scrollLock'
import { Icon } from '../icons/Icon'
import type { SymbolMatch } from '../../types'

interface Props {
  /** 이미 담은 티커 — 후보에 "담음" */
  owned: Set<string>
  onClose: () => void
  /** 담았다 — 홈에 한 줄로 알리고 다시 받는다 */
  onAdded: (message: string, pending: boolean) => void
  onError: (error: unknown) => void
}

/**
 * PC 홈 ⋯ → 종목 추가 (디자인 5차 목업 01d · 01f). 종목 메뉴를 없앴으므로 찾기 칸을 창으로 띄운다.
 * 찾아서 고르면 종목 탭과 같은 추가 시트(AddStockSheet)가 뜬다 — 넣는 값과 보내는 곳은 종목 탭과 같다.
 */
export function AddStockDialog({ owned, onClose, onAdded, onError }: Props) {
  const [form, setForm] = useState<NewStockForm>(emptyForm)
  const [picked, setPicked] = useState<SymbolMatch | null>(null)
  const [rawTicker, setRawTicker] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const sheetOpen = picked !== null || rawTicker !== null
  const pickedCurrency = picked ? CURRENCY_BY_MARKET[picked.market] : null
  const currencyMeta = pickedCurrency ? CURRENCY_META[pickedCurrency] : null

  const ref = useRef<HTMLDivElement>(null)
  useFocusTrap(ref, () => ref.current?.querySelector<HTMLInputElement>('input'))
  useBackToClose(onClose, !sheetOpen && !creating)
  useEffect(() => {
    if (sheetOpen) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    const release = lockBodyScroll()
    return () => {
      document.removeEventListener('keydown', onKey)
      release()
    }
  }, [onClose, sheetOpen])

  const closeSheet = useCallback(() => {
    setPicked(null)
    setRawTicker(null)
  }, [])

  const create = async (query: string) => {
    if (!query) return
    setCreating(true)
    try {
      const quantity = form.quantity === '' ? undefined : Number(form.quantity)
      const foreign = pickedCurrency !== null && pickedCurrency !== 'KRW'
      const result = await api.createStock({
        ticker: query,
        category: form.category.trim() === '' ? null : form.category.trim(),
        target_weight_pct: form.targetWeight === '' ? 0 : Number(form.targetWeight),
        ...(quantity ? { quantity } : {}),
        ...(form.avgCost === '' ? {} : { avg_cost: Number(form.avgCost) }),
        ...(foreign && form.avgFx !== '' ? { avg_fx: fxFromInput(form.avgFx, pickedCurrency) } : {}),
      })
      const name = stockLabel(result.stock)
      const label = name !== result.stock.ticker ? `${name} (${result.stock.ticker})` : name
      onAdded(
        result.data_pending
          ? `${label}을(를) 담았습니다. 시세를 받는 중이고, 다 받으면 저절로 채워집니다.`
          : result.data_loaded
            ? `${label}을(를) 담았습니다.`
            : `${label}은(는) 담았지만 시세를 받지 못했습니다. ${result.data_hint ?? '종목 화면의 보유에서 시세 갱신을 다시 눌러 주세요.'}`,
        !!result.data_pending,
      )
      onClose()
    } catch (e) {
      closeSheet()
      if (e instanceof ApiError && e.status === 409 && !e.hint && /already exists/.test(e.detail)) {
        onError(new ApiError(409, `${query}은(는) 이미 담은 종목입니다.`, e.detail))
      } else {
        onError(e)
      }
      onClose()
    } finally {
      setCreating(false)
    }
  }

  return (
    <>
      {!sheetOpen && (
        <div className="modal-backdrop" onClick={onClose}>
          <div
            ref={ref}
            className="modal add-stock-modal"
            role="dialog"
            aria-modal="true"
            aria-label="종목 추가"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <div className="modal-title">
                <h3>종목 추가</h3>
              </div>
              <button type="button" className="icon-btn" onClick={onClose} aria-label="닫기">
                <Icon name="close" size={20} />
              </button>
            </div>
            <div className="modal-body">
              <SymbolSearch
                focusOnMount
                selected={null}
                owned={owned}
                onSelect={(match) => {
                  if (!match) return
                  setForm((f) => ({ ...f, ticker: '' }))
                  setPicked(match)
                }}
                onSubmitRaw={(typed) => setRawTicker(typed)}
                onTypedChange={(typed) => setForm((f) => ({ ...f, ticker: typed }))}
                disabled={creating}
              />
              {form.ticker.trim() !== '' && (
                <button type="button" className="link-btn stock-find-raw" onClick={() => setRawTicker(form.ticker.trim())}>
                  "{form.ticker.trim()}" 그대로 추가
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {sheetOpen && (
        <AddStockSheet
          title={picked ? picked.name : (rawTicker ?? '')}
          sub={picked ? `${picked.ticker}, ${MARKET_LABEL[picked.market]}, ${currencyMeta?.label ?? ''}` : '목록에서 고르지 않은 이름입니다. 서버가 찾아 맞춥니다.'}
          form={form}
          onChange={setForm}
          currency={pickedCurrency}
          currencySymbol={currencyMeta?.symbol ?? null}
          currencyLabel={currencyMeta?.label ?? null}
          busy={creating}
          onSubmit={() => void create(picked?.ticker ?? rawTicker ?? form.ticker.trim())}
          onClose={closeSheet}
        />
      )}
    </>
  )
}
