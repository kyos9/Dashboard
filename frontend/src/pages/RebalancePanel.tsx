import { useMemo, useRef, useState } from 'react'
import { useAppState } from '../AppState'
import { api } from '../api/client'
import { useAuth } from '../components/AuthGate'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { ErrorNotice } from '../components/ErrorNotice'
import { NumberInput } from '../components/NumberInput'
import { MoneyLine } from '../components/PortfolioView'
import {
  amount,
  CURRENCY_META,
  num,
  price,
  qty,
  REVIEW_PERIOD_LABEL,
  reviewCountdown,
  rowLabel,
  signed,
  signedAmount,
  stockLabel,
} from '../lib/display'
import { fxFromInput, fxToInput, fxUnitLabel } from '../lib/fxInput'
import { useNarrow } from '../lib/narrow'
import { buildOrderPlan, krwRatesOf, NOISE_THRESHOLD_PCT, orderTitle, type OrderLine } from '../lib/orderPlan'
import { applyTrade, type TradeSide } from '../lib/trade'
import { useCachedLoad } from '../lib/cache'
import { PageSkeleton } from '../components/Skeleton'
import type {
  CashRow,
  Currency,
  RebalanceCurrent,
  RebalanceRow,
  RebalanceSnapshot,
  RebalanceTarget,
  ReviewPeriod,
  ReviewStatus,
  Settings,
  Stock,
} from '../types'

interface Row {
  ticker: string
  current: RebalanceRow
  target: RebalanceTarget | null
  stock: Stock | null
}

/** 숫자 칸의 처음 값. 소수 끝자리 잡음(0.30000000004)은 떼고 보여준다 */
function initial(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : String(Number(value.toFixed(4)))
}

function labelOf(row: Row): string {
  return row.stock?.name ?? rowLabel(row.current)
}

/** 카드 제목·저장 줄처럼 좁은 자리 — 대시보드와 같은 규칙(미국은 티커, 나머지는 종목명) */
function shortLabel(row: Row): string {
  return row.stock ? stockLabel(row.stock) : rowLabel(row.current)
}

/* ---------- 보유 · 목표 — 한 번에 저장 ----------
   줄마다 저장 버튼을 두면 셋을 고치고 둘만 저장하는 일이 생긴다. 대시보드 "설정"처럼 고친 줄에
   표시가 붙고, 아래에 "바뀐 N줄 저장 · 되돌리기"가 뜬다. "거래 입력"은 그 자리에서 바로 반영한다. */

interface HoldingDraft {
  quantity: string
  avg_cost: string
  avg_fx: string
  target: string
  band: string
}

function draftOf(row: Row): HoldingDraft {
  const c = row.current
  return {
    quantity: initial(c.quantity),
    avg_cost: initial(c.avg_cost),
    avg_fx: fxToInput(c.avg_fx, c.currency),
    target: initial(c.target_weight_pct),
    band: initial(row.target?.rebalance_band_pct),
  }
}

/** 무엇이 바뀌었나 — 보유(수량·평단가·산 환율)와 목표(비중·밴드)는 저장하는 곳이 다르다 */
function changesOf(row: Row, draft: HoldingDraft | undefined): { holding: boolean; fx: boolean; target: boolean } {
  if (!draft) return { holding: false, fx: false, target: false }
  const saved = draftOf(row)
  const fx = draft.avg_fx !== saved.avg_fx
  return {
    holding: draft.quantity !== saved.quantity || draft.avg_cost !== saved.avg_cost || fx,
    fx,
    target: draft.target !== saved.target || draft.band !== saved.band,
  }
}

async function saveRow(row: Row, draft: HoldingDraft) {
  const change = changesOf(row, draft)
  if (change.holding) {
    await api.updateHolding(
      row.ticker,
      Number(draft.quantity || 0),
      draft.avg_cost === '' ? null : Number(draft.avg_cost),
      // 산 환율은 고쳤을 때만 보낸다 — 엔은 100엔 단위로 받아 되돌리므로 안 고친 값도 끝자리가 흔들린다
      change.fx ? fxFromInput(draft.avg_fx, row.current.currency) : undefined,
    )
  }
  if (change.target) {
    await api.updateRebalanceTarget(row.ticker, {
      target_weight_pct: Number(draft.target || 0),
      rebalance_band_pct: draft.band === '' ? null : Number(draft.band),
    })
  }
}

/* ---------- 거래 입력 ---------- */

function TradeForm({
  row,
  fxNow,
  onSaved,
  onError,
  onClose,
}: {
  row: Row
  /** 지금 적용 중인 환율 (1단위에 몇 원) — 산 날 환율 칸의 처음 값 */
  fxNow: number | null
  onSaved: () => void
  onError: (e: unknown) => void
  onClose: () => void
}) {
  const current = row.current
  const native = current.currency
  const foreign = native !== 'KRW'
  const label = labelOf(row)
  const [side, setSide] = useState<TradeSide>('buy')
  const [tradeQty, setTradeQty] = useState('')
  // 대개 오늘 종가 근처에 산다 — 비워두는 것보다 고쳐 쓰는 편이 빠르다
  const [tradePrice, setTradePrice] = useState(initial(current.last_close))
  const [tradeFx, setTradeFx] = useState(fxToInput(fxNow, native))
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const apply = async () => {
    // 저장된 값에 반영한다 — 위 칸에서 고치다 만 숫자에 더하면 무엇에 더했는지 모르게 된다
    const result = applyTrade(
      { quantity: current.quantity, avg_cost: current.avg_cost, avg_fx: current.avg_fx ?? null },
      side,
      Number(tradeQty || 0),
      tradePrice === '' ? null : Number(tradePrice),
      foreign ? fxFromInput(tradeFx, native) : undefined,
    )
    if (!result.ok) {
      setProblem(result.reason)
      return
    }
    setBusy(true)
    try {
      const next = result.position
      if (foreign) await api.updateHolding(row.ticker, next.quantity, next.avg_cost, next.avg_fx ?? null)
      else await api.updateHolding(row.ticker, next.quantity, next.avg_cost)
      onClose()
      onSaved()
    } catch (e) {
      onError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="trade-form">
      <span className="trade-title">{label} 거래 반영</span>
      <div className="chip-row" role="group" aria-label="매수 또는 매도">
        <button className={`chip${side === 'buy' ? ' active' : ''}`} onClick={() => setSide('buy')}>
          샀다
        </button>
        <button className={`chip${side === 'sell' ? ' active' : ''}`} onClick={() => setSide('sell')}>
          팔았다
        </button>
      </div>
      <div className="input-with-button tight">
        <NumberInput
          value={tradeQty}
          onChange={(v) => {
            setTradeQty(v)
            setProblem(null)
          }}
          placeholder="수량"
          aria-label={`${row.ticker} 거래 수량`}
        />
        <span className="unit">주</span>
      </div>
      {side === 'buy' && (
        <div className="input-with-button tight">
          <span className="unit">{CURRENCY_META[native].symbol}</span>
          <NumberInput
            value={tradePrice}
            onChange={(v) => {
              setTradePrice(v)
              setProblem(null)
            }}
            placeholder="가격"
            allowDecimal={native === 'USD'}
            aria-label={`${row.ticker} 거래 가격`}
          />
        </div>
      )}
      {side === 'buy' && foreign && (
        <div className="input-with-button tight">
          <NumberInput
            value={tradeFx}
            onChange={(v) => {
              setTradeFx(v)
              setProblem(null)
            }}
            placeholder="그날 환율"
            aria-label={`${row.ticker} 산 날 환율`}
          />
          <span className="unit">{fxUnitLabel(native)}</span>
        </div>
      )}
      <button className="primary sm" onClick={() => void apply()} disabled={busy}>
        반영
      </button>
      <span className="hint">
        {problem ??
          (side === 'buy'
            ? foreign
              ? '수량을 더하고 평단가·산 환율을 금액 가중평균으로 다시 계산합니다.'
              : '수량을 더하고 평단가를 가중평균으로 다시 계산합니다.'
            : '수량만 뺍니다. 평단가는 그대로입니다.')}
      </span>
    </div>
  )
}

/* ---------- 보유 · 목표 한 줄 ---------- */

interface HoldingRowProps {
  row: Row
  draft: HoldingDraft
  dirty: boolean
  showFx: boolean
  fxNow: number | null
  busy: boolean
  onChange: (draft: HoldingDraft) => void
  onSaved: () => void
  onError: (e: unknown) => void
}

function PnlCell({ current }: { current: RebalanceRow }) {
  const pnl = current.shown_pnl ?? current.unrealized_pnl
  const currency = current.shown_currency ?? current.currency
  const pct = current.shown_return_pct ?? current.return_pct
  if (pnl === null) return <span className="hint">평단가 입력 시</span>
  return (
    <div className="metric">
      <span className="metric-value">{signedAmount(pnl, currency)}</span>
      <span className="metric-note">{signed(pct, 1, '%')}</span>
    </div>
  )
}

function useRowFields({ row, draft, onChange }: Pick<HoldingRowProps, 'row' | 'draft' | 'onChange'>) {
  const native = row.current.currency
  const set = (patch: Partial<HoldingDraft>) => onChange({ ...draft, ...patch })
  return {
    quantity: <NumberInput value={draft.quantity} onChange={(v) => set({ quantity: v })} aria-label={`${row.ticker} 보유수량`} />,
    avgCost: (
      <div className="input-with-button tight">
        <span className="unit">{CURRENCY_META[native].symbol}</span>
        <NumberInput
          value={draft.avg_cost}
          onChange={(v) => set({ avg_cost: v })}
          placeholder="모름"
          allowDecimal={native === 'USD'}
          aria-label={`${row.ticker} 평단가`}
        />
      </div>
    ),
    avgFx:
      native === 'KRW' ? (
        <span className="hint">—</span>
      ) : (
        <div className="input-with-button tight">
          <NumberInput
            value={draft.avg_fx}
            onChange={(v) => set({ avg_fx: v })}
            placeholder="모름"
            aria-label={`${row.ticker} 산 환율`}
          />
          <span className="unit">{fxUnitLabel(native)}</span>
        </div>
      ),
    target: (
      <div className="input-with-button tight">
        <NumberInput value={draft.target} onChange={(v) => set({ target: v })} aria-label={`${row.ticker} 목표 비중`} />
        <span className="unit">%</span>
      </div>
    ),
    band: (
      <div className="input-with-button tight">
        <NumberInput
          placeholder="기본값"
          value={draft.band}
          onChange={(v) => set({ band: v })}
          aria-label={`${row.ticker} 밴드 임계값`}
        />
        <span className="unit">%p</span>
      </div>
    ),
  }
}

function HoldingTableRow(props: HoldingRowProps) {
  const { row, dirty, showFx, fxNow, busy, onSaved, onError } = props
  const fields = useRowFields(props)
  const [trading, setTrading] = useState(false)
  const columns = showFx ? 8 : 7
  return (
    <>
      <tr className={dirty ? 'dirty' : undefined}>
        <td>
          <div className="ticker-cell">
            <span className="ticker-name">
              {labelOf(row)}
              {dirty && <span className="dirty-mark" title="저장 안 한 변경">●</span>}
            </span>
            <span className="ticker-sub">
              {row.ticker} · {price(row.current.last_close, row.current.currency)}
            </span>
          </div>
        </td>
        <td>{fields.quantity}</td>
        <td>{fields.avgCost}</td>
        {showFx && <td>{fields.avgFx}</td>}
        <td className={`num-cell`}>
          <PnlCell current={row.current} />
        </td>
        <td>{fields.target}</td>
        <td>{fields.band}</td>
        <td>
          <button className="sm" onClick={() => setTrading((t) => !t)} aria-expanded={trading} disabled={busy}>
            {trading ? '닫기' : '거래 입력'}
          </button>
        </td>
      </tr>
      {trading && (
        <tr className="trade-row">
          <td colSpan={columns}>
            <TradeForm row={row} fxNow={fxNow} onSaved={onSaved} onError={onError} onClose={() => setTrading(false)} />
          </td>
        </tr>
      )}
    </>
  )
}

/** 폰 — 한 종목이 카드 한 장. 칸마다 이름을 붙인다 (표 머리글이 없으므로) */
function HoldingCard(props: HoldingRowProps) {
  const { row, dirty, fxNow, busy, onSaved, onError } = props
  const fields = useRowFields(props)
  const [trading, setTrading] = useState(false)
  const foreign = row.current.currency !== 'KRW'
  return (
    <li className={`holding-edit${dirty ? ' dirty' : ''}`}>
      <div className="holding-edit-head">
        <span className="ticker-name">
          {shortLabel(row)}
          {dirty && <span className="dirty-mark" title="저장 안 한 변경">●</span>}
        </span>
        <span className="hint mono">{price(row.current.last_close, row.current.currency)}</span>
        <span className="holding-edit-pnl">
          <PnlCell current={row.current} />
        </span>
      </div>
      <div className="holding-edit-grid">
        <label>
          <span>보유수량</span>
          {fields.quantity}
        </label>
        <label>
          <span>평단가</span>
          {fields.avgCost}
        </label>
        {foreign && (
          <label>
            <span>산 환율</span>
            {fields.avgFx}
          </label>
        )}
        <label>
          <span>목표 비중</span>
          {fields.target}
        </label>
        <label>
          <span>밴드</span>
          {fields.band}
        </label>
      </div>
      <button className="sm trade-toggle" onClick={() => setTrading((t) => !t)} aria-expanded={trading} disabled={busy}>
        {trading ? '닫기' : '거래 입력'}
      </button>
      {trading && (
        <TradeForm row={row} fxNow={fxNow} onSaved={onSaved} onError={onError} onClose={() => setTrading(false)} />
      )}
    </li>
  )
}

/* ---------- 현금 ---------- */

function CashCard({
  cash,
  settings,
  currencies,
  baseCurrency,
  onSaved,
  onError,
}: {
  cash: CashRow | null
  settings: Settings
  currencies: Currency[]
  baseCurrency: Currency
  onSaved: () => void
  onError: (e: unknown) => void
}) {
  const [inputs, setInputs] = useState<Partial<Record<Currency, string>>>(() =>
    Object.fromEntries(currencies.map((c) => [c, initial(settings.cash[c])])),
  )
  const [target, setTarget] = useState(initial(settings.cash_target_pct))
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setBusy(true)
    try {
      await api.updateSettings({
        cash: Object.fromEntries(
          currencies.map((c) => [c, (inputs[c] ?? '') === '' ? null : Number(inputs[c])]),
        ),
        cash_target_pct: Number(target || 0),
      })
      onSaved()
    } catch (e) {
      onError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="kpi">
      <div className="kpi-head">
        <span className="kpi-title">현금</span>
        <span className="hint">
          {cash ? `${num(cash.actual_pct, 1)}% · 목표 ${num(cash.target_pct, 1)}%` : ''}
        </span>
      </div>
      {currencies.map((c) => (
        <div className="input-with-button" key={c}>
          <span className="unit">{CURRENCY_META[c].symbol}</span>
          <NumberInput
            value={inputs[c] ?? ''}
            onChange={(v) => setInputs((prev) => ({ ...prev, [c]: v }))}
            placeholder="0"
            allowDecimal={c === 'USD'}
            aria-label={`${CURRENCY_META[c].label} 현금`}
          />
        </div>
      ))}
      <div className="input-with-button">
        <span className="unit">목표</span>
        <NumberInput value={target} onChange={setTarget} placeholder="0" aria-label="현금 목표 비중" />
        <span className="unit">%</span>
        <button className="primary sm" onClick={() => void save()} disabled={busy}>
          {busy ? '저장 중…' : '저장'}
        </button>
      </div>
      <p className="kpi-foot">
        {cash && cash.value_base > 0
          ? `합계 ${amount(cash.value_base, baseCurrency)} · 목표 대비 ${signed(cash.excess_pct, 1, '%p')}`
          : '예수금·예금처럼 투자 대기 중인 돈. 목표비중은 현금까지 포함한 전체 자금 기준입니다.'}
      </p>
    </div>
  )
}

/* ---------- 리뷰 — 설정(주기·날짜)과 기록(지금 상태 남기기) ---------- */

function useSettingsUpdate(onSaved: () => void, onError: (e: unknown) => void) {
  const [busy, setBusy] = useState(false)
  const update = async (payload: Parameters<typeof api.updateSettings>[0]) => {
    setBusy(true)
    try {
      await api.updateSettings(payload)
      onSaved()
    } catch (e) {
      onError(e)
    } finally {
      setBusy(false)
    }
  }
  return { busy, update }
}

function ReviewSettings({
  settings,
  onSaved,
  onError,
}: {
  settings: Settings
  onSaved: () => void
  onError: (e: unknown) => void
}) {
  const [override, setOverride] = useState(settings.review_date_override ?? '')
  const { busy, update } = useSettingsUpdate(onSaved, onError)

  return (
    <div className="kpi">
      <div className="kpi-head">
        <span className="kpi-title">리뷰 주기</span>
      </div>
      <label className="field">
        <span>리뷰 주기</span>
        <select
          value={settings.review_period}
          disabled={busy}
          onChange={(e) => void update({ review_period: e.target.value as ReviewPeriod })}
        >
          {(Object.keys(REVIEW_PERIOD_LABEL) as ReviewPeriod[]).map((p) => (
            <option key={p} value={p}>
              {REVIEW_PERIOD_LABEL[p]}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>다음 리뷰일 직접 정하기</span>
        <div className="input-with-button tight">
          <input type="date" value={override} onChange={(e) => setOverride(e.target.value)} aria-label="다음 리뷰일" />
          <button
            className="sm"
            disabled={busy || override === (settings.review_date_override ?? '')}
            onClick={() => void update({ review_date_override: override === '' ? null : override })}
          >
            적용
          </button>
          {settings.review_date_override && (
            <button
              className="sm ghost"
              disabled={busy}
              onClick={() => {
                setOverride('')
                void update({ review_date_override: null })
              }}
            >
              주기로
            </button>
          )}
        </div>
      </label>
      <p className="kpi-foot">직접 정한 날 무렵 기록을 남기면 다시 주기로 돌아갑니다.</p>
    </div>
  )
}

function RecordPanel({
  review,
  onSaved,
  onError,
}: {
  review: ReviewStatus
  onSaved: () => void
  onError: (e: unknown) => void
}) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const record = async () => {
    setBusy(true)
    try {
      await api.createSnapshot(note.trim())
      setNote('')
      onSaved()
    } catch (e) {
      onError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`panel review-panel${review.due ? ' due' : ''}`}>
      <div className="review-head">
        <div>
          <span className="kpi-title">다음 리뷰</span>
          <div className="kpi-figure">
            <span className="big">{review.due ? '리뷰할 때' : reviewCountdown(review)}</span>
            <span className="hint mono">{review.next_date}</span>
          </div>
          <p className="kpi-foot">
            {review.override ? '직접 정한 날' : `${REVIEW_PERIOD_LABEL[review.period]} 마지막 거래일`}
            {review.last_snapshot_at && ` · 마지막 기록 ${review.last_snapshot_at.slice(0, 10)}`}
          </p>
        </div>
      </div>

      {review.due && (
        <p className="review-due-text">
          비중을 확인하고 필요한 만큼 사고판 뒤, 수량을 고치고 여기서 기록을 남기세요. 기록을 남기면 다음 리뷰일이
          다음 기간으로 넘어갑니다.
        </p>
      )}

      <div className="input-with-button record-row">
        <input
          type="text"
          value={note}
          maxLength={200}
          placeholder="메모 (선택)"
          onChange={(e) => setNote(e.target.value)}
          aria-label="기록 메모"
        />
        <button className="primary" onClick={() => void record()} disabled={busy}>
          {busy ? '기록 중…' : '지금 상태 기록하기'}
        </button>
      </div>
    </div>
  )
}

/* ---------- 지난 기록 ---------- */

function SnapshotList({
  snapshots,
  onDeleted,
  onError,
}: {
  snapshots: RebalanceSnapshot[]
  onDeleted: () => void
  onError: (e: unknown) => void
}) {
  const [deleting, setDeleting] = useState<RebalanceSnapshot | null>(null)
  const [busy, setBusy] = useState(false)

  const remove = async (snapshot: RebalanceSnapshot) => {
    setBusy(true)
    try {
      await api.deleteSnapshot(snapshot.id)
      setDeleting(null)
      onDeleted()
    } catch (e) {
      onError(e)
      setDeleting(null)
    } finally {
      setBusy(false)
    }
  }

  if (snapshots.length === 0) {
    return (
      <p className="hint">
        아직 남긴 기록이 없습니다. 리뷰할 때 "지금 상태 기록하기"를 누르면 그날의 수량·가격·비중이 그대로
        남아, 다음 리뷰 때 지난번과 비교할 수 있습니다.
      </p>
    )
  }

  return (
    <div className="snapshot-list">
      {snapshots.map((snapshot, index) => {
        const base = snapshot.base_currency
        const previous = snapshots[index + 1]
        // 기준통화가 다르면 금액을 나란히 빼는 게 뜻이 없다
        const change =
          previous && previous.base_currency === base
            ? snapshot.total_value_base - previous.total_value_base
            : null
        const pnl = snapshot.data.unrealized_pnl_base ?? null
        return (
          <details key={snapshot.id} className="snapshot">
            <summary>
              <span className="mono">{snapshot.taken_at.slice(0, 10)}</span>
              <span className="snapshot-total">{amount(snapshot.total_value_base, base)}</span>
              {change !== null && (
                <span className={`metric-note ${change > 0 ? 'up' : change < 0 ? 'down' : ''}`}>
                  직전 대비 {signedAmount(change, base)}
                </span>
              )}
              {snapshot.note && <span className="snapshot-note">{snapshot.note}</span>}
            </summary>
            <div className="table-scroll">
              <table className="data-table" style={{ minWidth: 620 }}>
                <thead>
                  <tr>
                    <th>종목</th>
                    <th>수량</th>
                    <th>가격</th>
                    <th>비중 (목표)</th>
                    <th>수익률</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.data.rows.map((r) => (
                    <tr key={r.ticker}>
                      <td>{r.name ?? r.ticker}</td>
                      <td className="num-cell">{qty(r.quantity)}</td>
                      <td className="num-cell">{price(r.last_close, r.currency)}</td>
                      <td className="num-cell">
                        {num(r.actual_weight_pct, 1)}% ({num(r.target_weight_pct, 1)}%)
                      </td>
                      <td className="num-cell">{r.return_pct === null ? '—' : signed(r.return_pct, 1, '%')}</td>
                    </tr>
                  ))}
                  <tr>
                    <td>현금</td>
                    <td className="num-cell" colSpan={2}>
                      {amount(snapshot.data.cash.value_base, base)}
                    </td>
                    <td className="num-cell">
                      {num(snapshot.data.cash.actual_pct, 1)}% ({num(snapshot.data.cash.target_pct, 1)}%)
                    </td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="snapshot-foot">
              <span className="hint">
                {snapshot.review_date && `리뷰 마감 ${snapshot.review_date} 기준 · `}
                {pnl !== null && `평가손익 ${signedAmount(pnl, base)} · `}
                {CURRENCY_META[base].label} 환산
              </span>
              <button className="sm danger" onClick={() => setDeleting(snapshot)}>
                기록 삭제
              </button>
            </div>
          </details>
        )
      })}

      {deleting && (
        <ConfirmDialog
          title="리밸런싱 기록 삭제"
          confirmLabel="네, 지웁니다"
          busyLabel="지우는 중…"
          busy={busy}
          onConfirm={() => void remove(deleting)}
          onCancel={() => setDeleting(null)}
        >
          <p>
            {deleting.taken_at.slice(0, 10)}에 남긴 기록을 지웁니다. 되돌릴 수 없고, 그날의 모습은 다시
            만들 수 없습니다.
          </p>
        </ConfirmDialog>
      )}
    </div>
  )
}

/* ---------- 주문 가이드 ---------- */

function ActionBadge({ action }: { action: OrderLine['action'] }) {
  if (action === 'buy') return <span className="badge badge-green">매수 (BUY)</span>
  if (action === 'sell') return <span className="badge badge-red">매도 (SELL)</span>
  return <span className="badge badge-grey">유지 (HOLD)</span>
}

function SignalBadges({ current }: { current: RebalanceRow }) {
  return (
    <div className="badge-row">
      {current.rebalance_signal.reasons.map((r) => (
        <span key={r} className="badge badge-purple">
          {r}
        </span>
      ))}
      {current.shoulder_signal_fired_in_period && <span className="badge badge-amber">기간 내 매도 시그널</span>}
      {!current.rebalance_signal.active && !current.shoulder_signal_fired_in_period && (
        <span className="hint">밴드 이내</span>
      )}
    </div>
  )
}

/* ---------- 화면 ---------- */

export function RebalancePanel() {
  const { refreshKey, notifyDataChanged } = useAppState()
  const { isAdmin } = useAuth()
  const narrow = useNarrow()
  const [rows, setRows] = useState<Row[]>([])
  const [current, setCurrent] = useState<RebalanceCurrent | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [snapshots, setSnapshots] = useState<RebalanceSnapshot[]>([])
  const [bandInput, setBandInput] = useState('')
  const [error, setError] = useState<unknown>(null)

  /** 통화별로 직접 입력한 환율 (빈 문자열이면 자동 조회값을 쓴다) */
  const [fxInputs, setFxInputs] = useState<Partial<Record<Currency, string>>>({})
  const [fxBusy, setFxBusy] = useState(false)

  /** 이번에 새로 넣을 돈 (계산만 한다 — 저장하지 않는다) */
  const [newMoney, setNewMoney] = useState('')

  /** 보유·목표 칸에서 고치는 중인 값 */
  const [drafts, setDrafts] = useState<Record<string, HoldingDraft>>({})
  const [saving, setSaving] = useState(false)
  // 환율 효과 켜기 — 누르는 즉시 표시를 바꾼다(저장 뒤 다시 받을 때까지 기다리면 눌러도 안 바뀐 것 같다)
  const [fxEffectDraft, setFxEffectDraft] = useState<boolean | null>(null)
  // 저장에 실패한 줄은 다시 받아 와도 고치던 값을 남긴다 — 나머지 줄만 서버 값으로 돌아간다
  const keepDrafts = useRef<Record<string, HoldingDraft>>({})

  // 탭을 옮겨 와도 들고 있던 값을 먼저 그린다 (ROADMAP 8-1)
  const { loading } = useCachedLoad(
    'page:rebalance',
    () =>
      Promise.all([
        api.getRebalanceCurrent(),
        api.listRebalanceTargets(),
        api.getSettings(),
        api.listStocks(),
        api.listSnapshots(),
      ]),
    ([cur, targets, s, stocks, snaps]) => {
      const targetBy = new Map(targets.map((t) => [t.ticker, t]))
      const stockBy = new Map(stocks.map((st) => [st.ticker, st]))
      const nextRows = cur.rows.map((c) => ({
        ticker: c.ticker,
        current: c,
        target: targetBy.get(c.ticker) ?? null,
        stock: stockBy.get(c.ticker) ?? null,
      }))
      setRows(nextRows)
      setDrafts({
        ...Object.fromEntries(nextRows.map((r) => [r.ticker, draftOf(r)])),
        ...keepDrafts.current,
      })
      keepDrafts.current = {}
      setCurrent(cur)
      setSettings(s)
      setFxEffectDraft(null)
      setSnapshots(snaps)
      setBandInput(String(s.default_rebalance_band_pct))
      setFxInputs(
        Object.fromEntries(
          Object.entries(s.fx_overrides ?? {}).map(([code, rate]) => [code, String(rate)]),
        ),
      )
    },
    setError,
    [refreshKey],
  )

  const baseCurrency: Currency = current?.base_currency ?? 'KRW'
  const fx = current?.fx ?? null
  const cash = current?.cash ?? null

  const handleSaved = () => {
    setError(null)
    notifyDataChanged()
  }

  const { busy: settingsBusy, update: updateSettings } = useSettingsUpdate(handleSaved, setError)

  const toggleFxEffect = async (next: boolean) => {
    setFxEffectDraft(next)
    try {
      await api.updateSettings({ include_fx_effect: next })
      handleSaved()
    } catch (e) {
      setFxEffectDraft(null)
      setError(e)
    }
  }

  const saveBand = () => void updateSettings({ default_rebalance_band_pct: Number(bandInput) })

  const saveFxOverride = async (currency: Currency) => {
    setFxBusy(true)
    try {
      const trimmed = (fxInputs[currency] ?? '').trim()
      // 보낸 통화만 바뀐다 — 엔을 고치다 달러 설정이 날아가면 안 된다
      await api.updateSettings({
        fx_overrides: { [currency]: trimmed === '' ? null : Number(trimmed) },
      })
      handleSaved()
    } catch (e) {
      setError(e)
    } finally {
      setFxBusy(false)
    }
  }

  const refreshFx = async () => {
    setFxBusy(true)
    try {
      await api.refreshFx()
      handleSaved()
    } catch (e) {
      setError(e)
    } finally {
      setFxBusy(false)
    }
  }

  const dirtyTickers = useMemo(
    () =>
      rows
        .filter((r) => {
          const c = changesOf(r, drafts[r.ticker])
          return c.holding || c.target
        })
        .map((r) => r.ticker),
    [rows, drafts],
  )

  const saveAll = async () => {
    if (dirtyTickers.length === 0) return
    setSaving(true)
    setError(null)
    const byTicker = new Map(rows.map((r) => [r.ticker, r]))
    // 고친 줄만, 한꺼번에. 한 줄이 실패해도 나머지는 저장한다
    const results = await Promise.allSettled(
      dirtyTickers.map((t) => saveRow(byTicker.get(t)!, drafts[t])),
    )
    const failed = dirtyTickers.filter((_, i) => results[i].status === 'rejected')
    keepDrafts.current = Object.fromEntries(failed.map((t) => [t, drafts[t]]))
    setSaving(false)
    const firstError = results.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined
    notifyDataChanged()
    if (firstError) setError(firstError.reason)
  }

  const resetDrafts = () => setDrafts(Object.fromEntries(rows.map((r) => [r.ticker, draftOf(r)])))

  const plan = useMemo(
    () =>
      buildOrderPlan(
        rows.map((r) => r.current),
        baseCurrency,
        krwRatesOf(fx),
        { value_base: cash?.value_base ?? 0, target_pct: cash?.target_pct ?? 0 },
        newMoney,
      ),
    [rows, baseCurrency, fx, cash, newMoney],
  )

  /** 주문 계획은 티커만 들고 있으므로, 화면에 필요한 나머지 정보를 여기서 붙인다 */
  const rowByTicker = useMemo(() => new Map(rows.map((r) => [r.ticker, r])), [rows])

  const hasMixedCurrencies = useMemo(
    () => new Set(rows.map((r) => r.current.currency)).size > 1,
    [rows],
  )

  /** 환율이 실제로 필요한 통화만 보여준다 — 일본 종목이 없으면 엔 칸도 뜨지 않는다 */
  const fxCurrencies = useMemo(() => {
    const held = new Set(rows.map((r) => r.current.currency))
    return (['USD', 'JPY'] as Currency[]).filter((c) => c !== baseCurrency && held.has(c))
  }, [rows, baseCurrency])

  /** 산 환율 칸 — 외화 종목이 하나라도 있을 때만 */
  const showFxColumn = rows.some((r) => r.current.currency !== 'KRW')

  /** 현금 칸 — 원·달러는 늘, 엔은 일본 종목이나 엔 현금이 있을 때만 */
  const cashCurrencies = useMemo(() => {
    const held = new Set<Currency>(rows.map((r) => r.current.currency))
    const saved = new Set(Object.keys(settings?.cash ?? {}) as Currency[])
    return (['KRW', 'USD', 'JPY'] as Currency[]).filter(
      (c) => c !== 'JPY' || held.has(c) || saved.has(c),
    )
  }, [rows, settings])

  /** 지금 추정치를 쓰고 있는 통화 — 경고에 어느 환율이 문제인지 적는다 */
  const estimatedCurrencies = fxCurrencies.filter((c) => fx?.rates?.[c]?.is_estimate)

  const signalled = rows.filter((r) => r.current.rebalance_signal.active)
  const targetOk = Math.abs(plan.targetSum - 100) < 0.01
  const fxNowOf = (currency: Currency) => (currency === 'KRW' ? null : (fx?.rates?.[currency]?.krw_rate ?? null))

  if (loading) return <PageSkeleton blocks={3} rows={6} />

  if (rows.length === 0 || !current) {
    return (
      <div className="empty-state">
        <h3>리밸런싱할 종목이 없습니다</h3>
        <p>종목 관리 화면에서 종목을 추가하고 목표 비중을 설정해주세요.</p>
      </div>
    )
  }

  const newMoneyBlock = (
    <div className="new-money">
      <label htmlFor="new-money">이번에 새로 넣을 돈 (선택)</label>
      <div className="input-with-button">
        <span className="unit">{CURRENCY_META[baseCurrency].symbol}</span>
        <NumberInput
          id="new-money"
          value={newMoney}
          onChange={setNewMoney}
          placeholder="0"
          allowDecimal={baseCurrency === 'USD'}
        />
      </div>
      <span className="hint">
        적립하는 달에 넣어보세요. 모자란 종목부터 채우는 주문이 나옵니다. 저장되지 않습니다.
      </span>
    </div>
  )

  const rowProps = (row: Row): HoldingRowProps => ({
    row,
    draft: drafts[row.ticker] ?? draftOf(row),
    dirty: dirtyTickers.includes(row.ticker),
    showFx: showFxColumn,
    fxNow: fxNowOf(row.current.currency),
    busy: saving,
    onChange: (draft) => setDrafts((prev) => ({ ...prev, [row.ticker]: draft })),
    onSaved: handleSaved,
    onError: setError,
  })

  return (
    <div className="rebalance">
      <div className="page-head">
        <div>
          <h2>리밸런싱</h2>
          <p className="hint">
            목표는 <b>현금을 포함한 전체 자금</b> 중의 비중입니다. 주문은 참고이고, 실제로 사고파는 것은 리뷰 때
            정합니다.
          </p>
        </div>
      </div>

      <ErrorNotice error={error} onDismiss={() => setError(null)} />

      {fx?.is_estimate && hasMixedCurrencies && (
        <div className="callout amber">
          <span className="ico">⚠</span>
          <div>
            환율을 받아오지 못해 추정치로 계산하고 있습니다
            {estimatedCurrencies.length > 0 && ` (${estimatedCurrencies.join(', ')})`}. 통화가 섞인
            포트폴리오라 비중이 실제와 다를 수 있으니, 아래 설정의 "적용 환율"에서 직접 입력하거나 다시
            조회해주세요.
          </div>
        </div>
      )}

      <MoneyLine current={current} />

      {!targetOk && (
        <div className="callout amber">
          <span className="ico">⚠</span>
          <div>
            목표 비중 합계가 {num(plan.targetSum, 1)}%입니다
            {plan.cash.targetPct > 0 && ` (현금 ${num(plan.cash.targetPct, 1)}% 포함)`} — 100%에서{' '}
            {signed(plan.targetSum - 100, 1, '%p')} 벗어나 목표 금액이 전체 자금과 어긋납니다.
          </div>
        </div>
      )}

      <section className="section" aria-labelledby="orders-title">
        <div className="section-head">
          <h3 id="orders-title">주문 가이드</h3>
          <span className="hint">
            비중조절 신호 {signalled.length}종목 · 조정 금액이 전체의 {NOISE_THRESHOLD_PCT}% 미만이면 "유지"
          </span>
        </div>
        {!narrow && newMoneyBlock}
        {narrow ? (
          <ul className="order-cards">
            {plan.orders.map((order) => {
              const row = rowByTicker.get(order.ticker)
              if (!row) return null
              const weightNow = plan.total > 0 ? (row.current.current_value_base / plan.total) * 100 : 0
              const drift = weightNow - row.current.target_weight_pct
              const isForeign = order.currency !== baseCurrency
              return (
                <li key={order.ticker} className={`order-card ${order.action}`}>
                  <div className="order-card-head">
                    <b>{orderTitle(shortLabel(row), order)}</b>
                    <span className="hint mono">
                      {drift > 0 ? '과중' : drift < 0 ? '미달' : '목표'} {signed(drift, 1, '%p')}
                    </span>
                  </div>
                  <p className="order-card-line mono">
                    {num(weightNow, 1)}% → 목표 {num(row.current.target_weight_pct, 0)}%
                    {order.action !== 'hold' && (
                      <>
                        {' '}
                        · {signedAmount(order.adjust, baseCurrency)}
                        {isForeign && ` (${signedAmount(order.adjustNative, order.currency)})`}
                      </>
                    )}
                  </p>
                  <SignalBadges current={row.current} />
                </li>
              )
            })}
            <li className="order-card cash">
              <div className="order-card-head">
                <b>현금</b>
                <span className="hint mono">목표 {num(plan.cash.targetPct, 0)}%</span>
              </div>
              <p className="order-card-line mono">
                {amount(plan.cash.current, baseCurrency)} → {amount(plan.cash.targetValue, baseCurrency)}
              </p>
            </li>
          </ul>
        ) : (
          <div className="table-scroll">
            <table className="data-table" style={{ minWidth: 1020 }}>
              <thead>
                <tr>
                  <th style={{ minWidth: 150 }}>구분 / 종목</th>
                  <th style={{ minWidth: 132 }}>현재 평가금액</th>
                  <th style={{ minWidth: 118 }}>목표 금액</th>
                  <th style={{ minWidth: 140 }}>조정 필요금액</th>
                  <th style={{ minWidth: 104 }}>
                    현재 비중
                    <br />
                    (목표 대비)
                  </th>
                  <th style={{ minWidth: 104 }}>주문 액션</th>
                  <th style={{ minWidth: 104 }}>예상 주문 주수</th>
                  <th style={{ minWidth: 140 }}>비중조절 신호</th>
                </tr>
              </thead>
              <tbody>
                {plan.orders.map(({ ticker, currency: native, targetValue, adjust, adjustNative, shares, action }) => {
                  const row = rowByTicker.get(ticker)
                  if (!row) return null
                  const isForeign = native !== baseCurrency
                  // 새로 넣을 돈이 있으면 비중도 그 돈까지 더한 전체 자금으로 다시 잰다
                  const weightNow = plan.total > 0 ? (row.current.current_value_base / plan.total) * 100 : 0
                  return (
                    <tr key={row.ticker}>
                      <td>
                        <div className="ticker-cell">
                          {row.stock?.category && <span className="cat-tag">{row.stock.category}</span>}
                          <span className="ticker-name">{labelOf(row)}</span>
                          <span className="ticker-sub">
                            {row.ticker} · {qty(row.current.quantity)}주 · {price(row.current.last_close, native)}
                          </span>
                        </div>
                      </td>
                      <td className="num-cell">
                        <div className="metric">
                          <span className="metric-value">{amount(row.current.current_value_base, baseCurrency)}</span>
                          {isForeign && (
                            <span className="metric-note">현지 {amount(row.current.current_value, native)}</span>
                          )}
                        </div>
                      </td>
                      <td className="num-cell">{amount(targetValue, baseCurrency)}</td>
                      <td className={`num-cell ${adjust > 0 ? 'up' : adjust < 0 ? 'down' : ''}`}>
                        <div className="metric">
                          <span className="metric-value">{signedAmount(adjust, baseCurrency)}</span>
                          {isForeign && action !== 'hold' && (
                            <span className="metric-note">주문 {signedAmount(adjustNative, native)}</span>
                          )}
                        </div>
                      </td>
                      <td>
                        <div className="metric">
                          <span className="metric-value">{num(weightNow, 1)}%</span>
                          <span className="metric-note">
                            목표 {num(row.current.target_weight_pct, 0)}% ·{' '}
                            {signed(weightNow - row.current.target_weight_pct, 1, '%p')}
                          </span>
                        </div>
                      </td>
                      <td>
                        <ActionBadge action={action} />
                      </td>
                      <td className="num-cell">
                        {shares === null || action === 'hold' ? '—' : `${signed(shares, 2)}주`}
                      </td>
                      <td>
                        <SignalBadges current={row.current} />
                      </td>
                    </tr>
                  )
                })}
                <tr className="cash-row">
                  <td>
                    <div className="ticker-cell">
                      <span className="ticker-name">현금</span>
                      <span className="ticker-sub">
                        {plan.newMoney > 0
                          ? `지금 ${amount(cash?.value_base ?? 0, baseCurrency)} + 새로 넣을 돈`
                          : '예수금·예금'}
                      </span>
                    </div>
                  </td>
                  <td className="num-cell">{amount(plan.cash.current, baseCurrency)}</td>
                  <td className="num-cell">{amount(plan.cash.targetValue, baseCurrency)}</td>
                  <td className={`num-cell ${plan.cash.adjust > 0 ? 'up' : plan.cash.adjust < 0 ? 'down' : ''}`}>
                    {signedAmount(plan.cash.adjust, baseCurrency)}
                  </td>
                  <td>
                    <div className="metric">
                      <span className="metric-value">
                        {num(plan.total > 0 ? (plan.cash.current / plan.total) * 100 : 0, 1)}%
                      </span>
                      <span className="metric-note">목표 {num(plan.cash.targetPct, 0)}%</span>
                    </div>
                  </td>
                  <td colSpan={3}>
                    <span className="hint">
                      {plan.cash.adjust < 0
                        ? '목표보다 많은 현금 — 매수 재원입니다.'
                        : plan.cash.adjust > 0
                          ? '목표보다 적은 현금 — 매도 대금이 여기로 옵니다.'
                          : '목표와 같습니다.'}
                    </span>
                  </td>
                </tr>
              </tbody>
              <tfoot>
                <tr>
                  <td>합계 ({CURRENCY_META[baseCurrency].symbol})</td>
                  <td className="num-cell">{amount(plan.total, baseCurrency)}</td>
                  <td className="num-cell">
                    {amount(plan.orders.reduce((s, o) => s + o.targetValue, 0) + plan.cash.targetValue, baseCurrency)}
                  </td>
                  <td className="num-cell">
                    {signedAmount(plan.orders.reduce((s, o) => s + o.adjust, 0) + plan.cash.adjust, baseCurrency)}
                  </td>
                  <td colSpan={4} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        {/* 폰에서는 답(카드)이 먼저 — 새로 넣을 돈은 그 아래 */}
        {narrow && newMoneyBlock}
      </section>

      <section className="section" aria-labelledby="holdings-edit-title">
        <div className="section-head">
          <h3 id="holdings-edit-title">보유 · 목표 비중</h3>
          <span className="hint">
            샀거나 팔았으면 "거래 입력"으로 반영하세요. 평단가·산 환율은 손익 표시에만 쓰이고 비중에는 영향이 없습니다.
          </span>
        </div>
        {narrow ? (
          <ul className="holding-edit-list">
            {rows.map((row) => (
              <HoldingCard key={row.ticker} {...rowProps(row)} />
            ))}
          </ul>
        ) : (
          <div className="table-scroll">
            <table className="data-table fixed" style={{ minWidth: showFxColumn ? 1120 : 980 }}>
              <thead>
                <tr>
                  <th style={{ width: 190 }}>종목</th>
                  <th style={{ width: 120 }}>보유수량</th>
                  <th style={{ width: 150 }}>평단가</th>
                  {showFxColumn && <th style={{ width: 150 }}>산 환율</th>}
                  <th style={{ width: 130 }}>평가손익</th>
                  <th style={{ width: 120 }}>목표 비중</th>
                  <th style={{ width: 140 }}>
                    밴드 임계값
                    <br />
                    (비워두면 기본값)
                  </th>
                  <th style={{ width: 120 }}>거래</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <HoldingTableRow key={row.ticker} {...rowProps(row)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
        {dirtyTickers.length > 0 && (
          <div className="save-bar" role="status">
            <span>
              바뀐 {dirtyTickers.length}줄 ({dirtyTickers.map((t) => shortLabel(rowByTicker.get(t)!)).join(', ')})
            </span>
            <div className="btn-group tight">
              <button className="primary sm" onClick={() => void saveAll()} disabled={saving}>
                {saving ? '저장 중…' : `바뀐 ${dirtyTickers.length}줄 저장`}
              </button>
              <button className="sm" onClick={resetDrafts} disabled={saving}>
                되돌리기
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="section" aria-labelledby="records-title">
        <div className="section-head">
          <h3 id="records-title">리뷰 · 기록 {snapshots.length > 0 && `${snapshots.length}건`}</h3>
          <span className="hint">리뷰할 때 남긴 모습 그대로입니다. 종목을 지우거나 목표를 바꿔도 달라지지 않습니다.</span>
        </div>
        <RecordPanel review={current.review} onSaved={handleSaved} onError={setError} />
        <SnapshotList snapshots={snapshots} onDeleted={handleSaved} onError={setError} />
      </section>

      <details className="section settings-fold">
        <summary>
          <h3>설정</h3>
          <span className="hint">리뷰 주기 · 현금 · 기준통화·환율 · 밴드</span>
        </summary>
        <div className="kpi-grid">
          {settings && (
            <ReviewSettings
              key={`${settings.review_period}-${settings.review_date_override ?? ''}`}
              settings={settings}
              onSaved={handleSaved}
              onError={setError}
            />
          )}

          {settings && (
            <CashCard
              key={JSON.stringify([settings.cash, settings.cash_target_pct, cashCurrencies])}
              cash={cash}
              settings={settings}
              currencies={cashCurrencies}
              baseCurrency={baseCurrency}
              onSaved={handleSaved}
              onError={setError}
            />
          )}

          <div className="kpi">
            <div className="kpi-head">
              <span className="kpi-title">기준통화 · 적용 환율</span>
            </div>
            <div className="btn-group" style={{ marginBottom: 8 }}>
              {(['KRW', 'USD', 'JPY'] as Currency[]).map((c) => (
                <button
                  key={c}
                  className={`sm${baseCurrency === c ? ' primary' : ' ghost'}`}
                  onClick={() => void updateSettings({ base_currency: c })}
                  disabled={baseCurrency === c || settingsBusy}
                >
                  {CURRENCY_META[c].symbol} {c}
                </button>
              ))}
            </div>
            {fxCurrencies.length === 0 ? (
              <p className="kpi-foot">
                환산할 외화 종목이 없습니다.
                <br />
                해외 종목을 담으면 그 통화의 환율 칸이 여기 생깁니다.
              </p>
            ) : (
              <>
                {fxCurrencies.map((c) => {
                  const quote = fx?.rates?.[c]
                  const meta = CURRENCY_META[c]
                  return (
                    <div key={c}>
                      <div className="input-with-button">
                        <NumberInput
                          placeholder={quote ? num(quote.krw_rate, 2) : '자동'}
                          value={fxInputs[c] ?? ''}
                          onChange={(v) => setFxInputs((prev) => ({ ...prev, [c]: v }))}
                          aria-label={`원/${meta.label} 환율 직접 입력`}
                        />
                        <span className="unit">원/{meta.symbol}</span>
                        <button className="primary sm" onClick={() => void saveFxOverride(c)} disabled={fxBusy}>
                          적용
                        </button>
                      </div>
                      <p className="kpi-foot">
                        {quote
                          ? `1${meta.label} = ${num(quote.krw_rate, 2)}원 · ${
                              quote.source === 'override'
                                ? '직접 입력한 값'
                                : quote.source === 'fallback'
                                  ? '조회 실패, 추정치'
                                  : '자동 조회값'
                            }`
                          : '환율 정보 없음'}
                      </p>
                    </div>
                  )
                })}
                {/* 환율은 전원이 같이 쓴다 — 다시 받는 건 관리자만. 직접 넣는 칸은 내 것이라 누구나 */}
                {isAdmin && (
                  <div className="btn-group tight">
                    <button className="sm ghost" onClick={() => void refreshFx()} disabled={fxBusy}>
                      전체 조회
                    </button>
                  </div>
                )}
                <p className="kpi-foot">비워두고 적용하면 자동 조회값으로 돌아갑니다.</p>
              </>
            )}
            {showFxColumn && settings && (
              <>
                <label className={`toggle-line${baseCurrency !== 'KRW' ? ' disabled' : ''}`}>
                  <input
                    type="checkbox"
                    checked={fxEffectDraft ?? !!settings.include_fx_effect}
                    disabled={baseCurrency !== 'KRW' || settingsBusy}
                    onChange={(e) => void toggleFxEffect(e.target.checked)}
                  />
                  수익률에 환율 효과 포함
                </label>
                <p className="kpi-foot">
                  {baseCurrency !== 'KRW'
                    ? '기준통화가 원일 때만 켤 수 있습니다 — 달러·엔 기준이면 "산 환율"의 뜻이 종목마다 달라집니다.'
                    : '켜면 산 환율을 적은 외화 종목의 수익률·평가손익을 원화로 따집니다. 비중에는 영향이 없습니다.'}
                </p>
              </>
            )}
          </div>

          <div className="kpi">
            <div className="kpi-head">
              <span className="kpi-title">전역 기본 밴드</span>
            </div>
            <div className="input-with-button">
              <NumberInput value={bandInput} onChange={setBandInput} aria-label="전역 기본 밴드" />
              <span className="unit">%p</span>
              <button className="primary sm" onClick={saveBand} disabled={settingsBusy}>
                저장
              </button>
            </div>
            <p className="kpi-foot">
              종목별 밴드를 비워두면 이 값이 적용됩니다. 현재 적용값 {settings?.default_rebalance_band_pct ?? '—'}%p
            </p>
          </div>

          <div className="kpi">
            <div className="kpi-head">
              <span className="kpi-title">목표 비중 합계</span>
            </div>
            <div className="kpi-figure">
              <span className={`big ${targetOk ? 'up' : 'down'}`}>{num(plan.targetSum, 1)}%</span>
            </div>
            <p className="kpi-foot">
              {plan.cash.targetPct > 0 && `현금 ${num(plan.cash.targetPct, 1)}% 포함 · `}
              {targetOk ? '합계가 100%로 맞습니다.' : '100%가 되게 맞춰주세요.'}
            </p>
          </div>
        </div>
      </details>
    </div>
  )
}
