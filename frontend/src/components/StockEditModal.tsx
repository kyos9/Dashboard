import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api/client'
import { useBackToClose } from '../lib/backToClose'
import { CURRENCY_META, MARKET_LABEL, stockLabel } from '../lib/display'
import { fxFromInput, fxUnitLabel } from '../lib/fxInput'
import { CATEGORY_SUGGESTIONS, changesOf, draftOf, type EditDraft, type EditField, type HoldingValues } from '../lib/stockEdit'
import type { Stock } from '../types'
import { ConfirmDialog } from './ConfirmDialog'
import { ErrorNotice } from './ErrorNotice'
import { NumberInput } from './NumberInput'
import { HOLDING_MINUS_HINT } from '../lib/numberDropped'
import { lockBodyScroll } from '../lib/scrollLock'

interface Props {
  /** 고칠 종목들 — 보이는 순서 그대로 */
  stocks: Stock[]
  holdings: Map<string, HoldingValues>
  /** 현금 목표 비중 — 목표 합계가 100%가 되는지 같이 보인다 */
  cashTargetPct?: number
  /** 처음 커서를 둘 자리. "평단가 입력"으로 열면 그 종목의 평단가 */
  focus?: { ticker: string; field: EditField }
  onClose: () => void
  /** 하나라도 저장했으면 부른다 — 뒤 화면을 새로 받는다 */
  onSaved: () => void
}

/**
 * 종목 한 번에 수정 (ROADMAP 9-11).
 *
 * 전에는 고치는 자리가 흩어져 있었다 — 보유는 줄마다 "수정" 팝업, 구분·목표 비중은 종목 관리의
 * 줄마다 "저장". 이제 **수정 버튼 하나**로 모든 종목의 모든 칸을 한 화면에서 고치고 한 번에
 * 저장한다. 저장하는 곳은 전과 같다(`PUT /api/stocks/{t}` · `PUT /api/rebalance/holdings/{t}`),
 * 그래서 어느 화면에서 고쳐도 나머지 화면이 같은 값을 본다.
 *
 * - 바뀐 종목의 바뀐 쪽만 보낸다. 한 종목이 실패해도 나머지는 저장되고, 실패한 종목만 남는다.
 * - 산 환율은 **고쳤을 때만** 보낸다 — 엔은 100엔 단위로 받아 되돌리므로 안 고친 값도 끝자리가
 *   흔들린다(리밸런싱 탭과 같은 규칙).
 * - 폰의 뒤로가기·취소·✕·Esc·바깥 누르기는 **저장 안 한 것이 있으면 묻는다**
 *   (0.45.0 — 전에는 그대로 닫아, 저장에 실패한 종목이 남은 채 뒤로가기를 누르면 말없이 사라졌다).
 * - 저장에 실패하면 첫 실패 줄로 옮긴다 — 폰에서는 아래 칸에 쌓인 오류가 그 줄을 가렸다(0.45.0).
 */
export function StockEditModal({ stocks, holdings, cashTargetPct = 0, focus, onClose, onSaved }: Props) {
  // 처음 연 값. 저장에 성공한 종목은 그 값이 새 기준이 된다
  const [base, setBase] = useState<Record<string, EditDraft>>(() =>
    Object.fromEntries(stocks.map((s) => [s.ticker, draftOf(s, holdings.get(s.ticker))])),
  )
  const [drafts, setDrafts] = useState<Record<string, EditDraft>>(base)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [failed, setFailed] = useState<string[]>([])
  const [asking, setAsking] = useState(false)
  const savedAny = useRef(false)
  const bodyRef = useRef<HTMLDivElement>(null)

  const dirty = useMemo(
    () =>
      stocks.filter((s) => {
        const c = changesOf(base[s.ticker], drafts[s.ticker])
        return c.stock || c.holding
      }),
    [stocks, base, drafts],
  )

  const targetSum =
    stocks.filter((s) => s.active).reduce((sum, s) => sum + Number(drafts[s.ticker].target || 0), 0) + cashTargetPct

  const close = () => {
    if (busy) return
    if (savedAny.current) onSaved()
    onClose()
  }

  // 저장 안 한 것이 있으면 닫지 않고 묻는다 — 뒤로가기는 칸을 다시 쌓고 확인 창을 그 위에 띄운다
  const requestClose = () => {
    if (busy) return
    if (dirty.length > 0) setAsking(true)
    else close()
  }
  useBackToClose(close, !busy && dirty.length === 0, () => !busy && setAsking(true))

  // 저장에 실패하면 첫 실패 줄로 — 그 줄이 화면 밖이거나 아래 칸에 가려 있었다
  useEffect(() => {
    if (failed.length === 0) return
    const row = bodyRef.current?.querySelector<HTMLElement>(`[data-ticker="${CSS.escape(failed[0])}"]`)
    row?.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
  }, [failed])

  // 처음 커서 — 고른 종목의 고른 칸, 없으면 첫 종목의 수량
  useEffect(() => {
    const root = bodyRef.current
    if (!root) return
    const ticker = focus?.ticker ?? stocks[0]?.ticker
    if (!ticker) return
    const box = root.querySelector<HTMLElement>(`[data-ticker="${CSS.escape(ticker)}"]`)
    const input = box?.querySelector<HTMLInputElement>(`[data-field="${focus?.field ?? 'quantity'}"] input`)
    box?.scrollIntoView?.({ block: 'center' })
    input?.focus({ preventScroll: true })
    // 처음 한 번만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ESC — 고친 것이 없으면 닫고, 있으면 묻는다(✕·뒤로가기와 같게, 0.45.0 D 사용자 확인) + 뒤 화면이 같이 스크롤되지 않게
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 확인 창이 떠 있으면 그 창이 Esc 를 받는다(계속 고치기)
      if (e.key === 'Escape' && !asking) requestClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })
  useEffect(() => {
    const release = lockBodyScroll()
    return () => {
      release()
    }
  }, [])

  const change = (ticker: string, key: keyof EditDraft, value: string) =>
    setDrafts((prev) => ({ ...prev, [ticker]: { ...prev[ticker], [key]: value } }))

  const saveOne = async (stock: Stock) => {
    const before = base[stock.ticker]
    const draft = drafts[stock.ticker]
    const what = changesOf(before, draft)
    const jobs: Promise<unknown>[] = []
    if (what.stock) {
      jobs.push(
        api.updateStock(stock.ticker, {
          // 미국 종목은 티커가 곧 이름 — 고칠 칸이 없으므로 보내지 않는다
          ...(stock.market === 'US' ? {} : { name: draft.name.trim() === '' ? null : draft.name.trim() }),
          category: draft.category.trim() === '' ? null : draft.category.trim(),
          target_weight_pct: Number(draft.target || 0),
          rebalance_band_pct: draft.band.trim() === '' ? null : Number(draft.band),
        }),
      )
    }
    if (what.holding) {
      const foreign = stock.currency !== 'KRW'
      jobs.push(
        api.updateHolding(
          stock.ticker,
          Number(draft.quantity || 0),
          draft.avgCost.trim() === '' ? null : Number(draft.avgCost),
          foreign && draft.avgFx.trim() !== before.avgFx.trim() ? fxFromInput(draft.avgFx, stock.currency) : undefined,
        ),
      )
    }
    await Promise.all(jobs)
  }

  const save = async () => {
    if (dirty.length === 0) return
    setBusy(true)
    setError(null)
    setFailed([])
    // 한꺼번에 보낸다 — 한 종목씩 기다리면 종목 수만큼 왕복이 쌓인다
    const results = await Promise.allSettled(dirty.map(saveOne))
    const ok = dirty.filter((_, i) => results[i].status === 'fulfilled')
    const bad = dirty.filter((_, i) => results[i].status === 'rejected')
    if (ok.length > 0) {
      savedAny.current = true
      setBase((prev) => ({ ...prev, ...Object.fromEntries(ok.map((s) => [s.ticker, drafts[s.ticker]])) }))
    }
    setBusy(false)
    if (bad.length === 0) {
      onSaved()
      onClose()
      return
    }
    const first = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')
    setFailed(bad.map((s) => s.ticker))
    setError(first?.reason ?? '저장하지 못했습니다.')
  }

  const failedLabels = stocks.filter((s) => failed.includes(s.ticker)).map(stockLabel)
  // 구분 칸의 추천값 — 이미 쓰는 구분과 흔한 예시
  const categories = [...new Set([...stocks.map((s) => s.category ?? '').filter(Boolean), ...CATEGORY_SUGGESTIONS])]

  return (
    // 바로 이 어두운 곳을 눌렀을 때만 — 안에 뜬 확인 창의 바깥을 누른 것이 올라와 다시 묻지 않게
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && requestClose()}>
      <div
        className="modal stock-edit-modal"
        role="dialog"
        aria-modal="true"
        aria-label="종목 한 번에 수정"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div className="modal-title">
            <h3>종목 한 번에 수정</h3>
            <span className="hint">{stocks.length}종목</span>
          </div>
          <button className="icon-btn" onClick={requestClose} disabled={busy} aria-label="닫기">
            ✕
          </button>
        </div>
        <p className="stock-edit-sum">
          <span className={`badge ${Math.abs(targetSum - 100) < 0.01 ? 'badge-green' : 'badge-amber'}`}>
            목표 비중 합계 {targetSum.toFixed(1)}%{cashTargetPct > 0 && ` (현금 ${cashTargetPct.toFixed(1)}% 포함)`}
          </span>
        </p>

        <datalist id="stock-edit-categories">
          {categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <div className="stock-edit-list" ref={bodyRef}>
            {stocks.map((stock) => (
              <StockFields
                key={stock.ticker}
                stock={stock}
                draft={drafts[stock.ticker]}
                dirty={dirty.includes(stock)}
                failed={failed.includes(stock.ticker)}
                disabled={busy}
                onChange={(key, value) => change(stock.ticker, key, value)}
              />
            ))}
          </div>

          <div className="stock-edit-foot">
            {failedLabels.length > 0 && (
              <p className="error-text" role="alert">
                저장하지 못한 종목: {failedLabels.join(', ')} — 나머지는 저장했습니다.
              </p>
            )}
            <ErrorNotice error={error} />
            {/* 오류가 있을 때는 늘 보이는 안내를 접는다 — 폰에서 아래 칸이 화면 절반을 덮었다 */}
            {failedLabels.length === 0 && !error && (
              <p className="hint">
                수량을 비우면 0 — 관심 종목으로 내려갑니다. 평단가를 비우면 손익만 비고 비중은 그대로입니다. 밴드를
                비우면 기본값을 씁니다.
              </p>
            )}
            <div className="btn-group confirm-actions">
              <button type="button" disabled={busy} onClick={requestClose}>
                취소
              </button>
              <button type="submit" className="primary" disabled={busy || dirty.length === 0}>
                {busy ? '저장 중…' : dirty.length > 0 ? `${dirty.length}종목 저장` : '저장'}
              </button>
            </div>
          </div>
        </form>
      </div>
      {asking && (
        <ConfirmDialog
          title="저장하지 않고 닫을까요?"
          confirmLabel="버리고 닫기"
          cancelLabel="계속 고치기"
          onConfirm={() => {
            setAsking(false)
            close()
          }}
          onCancel={() => setAsking(false)}
        >
          <p>
            저장하지 않은 종목 {dirty.length}개({dirty.map(stockLabel).join(', ')})가 있습니다. 닫으면 고친 것이
            사라집니다.
          </p>
        </ConfirmDialog>
      )}
    </div>
  )
}

function StockFields({
  stock,
  draft,
  dirty,
  failed,
  disabled,
  onChange,
}: {
  stock: Stock
  draft: EditDraft
  dirty: boolean
  failed: boolean
  disabled: boolean
  onChange: (key: keyof EditDraft, value: string) => void
}) {
  const label = stockLabel(stock)
  const meta = CURRENCY_META[stock.currency]
  const foreign = stock.currency !== 'KRW'
  return (
    <fieldset
      className={`stock-edit-row${dirty ? ' dirty' : ''}${failed ? ' failed' : ''}${stock.active ? '' : ' inactive'}`}
      data-ticker={stock.ticker}
      disabled={disabled}
    >
      <legend>
        <span className="ticker-name">{label}</span>
        {dirty && (
          <span className="dirty-mark" title="저장 안 한 변경">
            ●
          </span>
        )}
        <span className="hint">
          {stock.ticker} · {MARKET_LABEL[stock.market]} · {stock.currency}
          {!stock.active && ' · 비활성'}
        </span>
      </legend>
      <div className="stock-edit-fields">
        {stock.market !== 'US' && (
          <label className="field" data-field="name">
            <span>표시 이름</span>
            <input
              type="text"
              value={draft.name}
              // 비우면 공용 종목명으로 보인다 (0.42.0) — 칸 안 글도 그 이름이어야 "비우면 티커"로 읽히지 않는다
              placeholder={stock.shown_name || stock.ticker}
              onChange={(e) => onChange('name', e.target.value)}
              aria-label={`${label} 표시 이름`}
            />
          </label>
        )}
        <label className="field" data-field="category">
          <span>구분</span>
          <input
            type="text"
            list="stock-edit-categories"
            value={draft.category}
            placeholder="예: 지수"
            onChange={(e) => onChange('category', e.target.value)}
            aria-label={`${label} 구분`}
          />
        </label>
        <label className="field" data-field="target">
          <span>목표 비중</span>
          <span className="input-with-button tight">
            <NumberInput value={draft.target} onChange={(v) => onChange('target', v)} placeholder="0" aria-label={`${label} 목표 비중`} />
            <span className="unit">%</span>
          </span>
        </label>
        <label className="field" data-field="band">
          <span>밴드</span>
          <span className="input-with-button tight">
            <NumberInput value={draft.band} onChange={(v) => onChange('band', v)} placeholder="기본값" aria-label={`${label} 밴드 임계값`} />
            <span className="unit">%p</span>
          </span>
        </label>
        <label className="field" data-field="quantity">
          <span>보유 수량</span>
          <span className="input-with-button tight">
            <NumberInput value={draft.quantity} onChange={(v) => onChange('quantity', v)} placeholder="0" aria-label={`${label} 보유수량`} minusHint={HOLDING_MINUS_HINT} />
            <span className="unit">주</span>
          </span>
        </label>
        <label className="field" data-field="avgCost">
          <span>평단가 ({meta.label})</span>
          <span className="input-with-button tight">
            <span className="unit">{meta.symbol}</span>
            <NumberInput value={draft.avgCost} onChange={(v) => onChange('avgCost', v)} placeholder="모름" aria-label={`${label} 평단가`} />
          </span>
        </label>
        {foreign && (
          <label className="field" data-field="avgFx">
            <span>산 환율</span>
            <span className="input-with-button tight">
              <NumberInput value={draft.avgFx} onChange={(v) => onChange('avgFx', v)} placeholder="모름" aria-label={`${label} 산 환율`} />
              <span className="unit">{fxUnitLabel(stock.currency)}</span>
            </span>
          </label>
        )}
      </div>
    </fieldset>
  )
}
