import { NoStocksYet } from '../components/NoStocksYet'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useAppState } from '../AppState'
import { api } from '../api/client'
import { useAuth } from '../components/AuthGate'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { ErrorNotice } from '../components/ErrorNotice'
import { PageIntro } from '../components/PageIntro'
import { NumberInput } from '../components/NumberInput'
import { TRADE_MINUS_HINT } from '../lib/numberDropped'
import { Link } from 'react-router-dom'
import { Icon } from '../components/icons/Icon'
import { Sheet } from '../components/ui/Sheet'
import { OrderGroup, OrderRowButton, OrderSplit, type OrderRowItem } from '../components/rebalance/OrderRows'
import { RebalanceStrip } from '../components/rebalance/RebalanceStrip'
import { SettingsForm } from '../components/rebalance/SettingsForm'
import { RebalanceSummary } from '../components/rebalance/RebalanceSummary'
import { TargetSheet, type TargetLine } from '../components/rebalance/TargetSheet'
import { usePrefs } from '../lib/prefs'
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
import { useMedia, useNarrow } from '../lib/narrow'
import {
  buildOrderPlan,
  isZeroTargetSell,
  krwRatesOf,
  NOISE_THRESHOLD_PCT,
  orderTitle,
  sharesText,
  ZERO_TARGET_NOTE,
  ZERO_TARGET_SHORT,
  zeroTargetSummary,
  type OrderLine,
} from '../lib/orderPlan'
import { applyTrade, type TradeSide } from '../lib/trade'
import { useCachedLoad } from '../lib/cache'
import { PageSkeleton } from '../components/Skeleton'
import { ReasonTag, SignalShape } from '../components/SignalShape'
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
  ValueRecord,
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

/** 무엇이 바뀌었나 — 보유(수량·평단가와 매수 환율)와 목표(비중·밴드)는 저장하는 곳이 다르다 */
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
      // 매수 환율은 고쳤을 때만 보낸다 — 엔은 100엔 단위로 받아 되돌리므로 안 고친 값도 끝자리가 흔들린다
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

/** 매도 시그널 칸 머리 — 리뷰 주기의 지금 기간 (서버 _shoulder_flags 와 같은 구간) */
const PERIOD_NOW: Record<ReviewPeriod, string> = { quarterly: '이번 분기', semiannual: '이번 반기', annual: '올해' }

/* ---------- 거래 입력 ---------- */

function TradeForm({
  row,
  fxNow,
  initialSide = 'buy',
  initialQty = '',
  onSaved,
  onError,
  onClose,
}: {
  row: Row
  /** 지금 적용 중인 환율 (1단위에 몇 원) — 산 날 환율 칸의 처음 값 */
  fxNow: number | null
  /** 주문 가이드에서 열면 그 주문의 사기·팔기와 정수 주 (디자인 2차, 주인 결정 ②) — 고쳐 쓰는 처음 값일 뿐이다 */
  initialSide?: TradeSide
  initialQty?: string
  /** 반영한 거래 — 주문 가이드가 반영 뒤 바뀐 이유를 한 줄로 알릴 때 쓴다 */
  onSaved: (done?: { side: TradeSide; qty: number }) => void
  onError: (e: unknown) => void
  onClose: () => void
}) {
  const current = row.current
  const native = current.currency
  const foreign = native !== 'KRW'
  const label = labelOf(row)
  const [side, setSide] = useState<TradeSide>(initialSide)
  const [tradeQty, setTradeQty] = useState(initialQty)
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
      onSaved({ side, qty: Number(tradeQty || 0) })
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
          매수
        </button>
        <button className={`chip${side === 'sell' ? ' active' : ''}`} onClick={() => setSide('sell')}>
          매도
        </button>
      </div>
      <div className="input-with-button tight">
        <NumberInput
          value={tradeQty}
          // "매수"인 채 -3 을 치면 3주 산 것으로 저장된다 — 고른 쪽이 "샀다"일 때만 (0.45.2 A2)
          minusHint={side === 'buy' ? TRADE_MINUS_HINT : undefined}
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
              ? '수량을 더하고 평단가와 매수 환율을 금액 가중평균으로 다시 계산합니다.'
              : '수량을 더하고 평단가를 가중평균으로 다시 계산합니다.'
            : '수량만 뺍니다. 평단가는 그대로입니다.')}
      </span>
    </div>
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
    <div className="kpi cash-settings">
      <div className="kpi-head">
        <span className="kpi-title">현금</span>
        <span className="hint">
          {cash ? `현재 ${num(cash.actual_pct, 1)}%, 목표 ${num(cash.target_pct, 1)}%` : ''}
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
          ? `합계 ${amount(cash.value_base, baseCurrency)}, 목표 대비 ${signed(cash.excess_pct, 1, '%p')}`
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
            {review.last_snapshot_at && `, 마지막 기록 ${review.last_snapshot_at.slice(0, 10)}`}
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
          {busy ? '기록 중…' : '현재 상태 기록'}
        </button>
      </div>
    </div>
  )
}

/* ---------- 지난 기록 ---------- */

/**
 * 날마다의 평가금액 (0.44.0) — 서버가 매일 아침 스스로 남기는 기록이 쌓이고 있다는 한 줄.
 * 위의 리뷰 기록("지금 상태 기록하기")과 다른 것이라 그렇다고 같이 적는다. 옛 서버·꺼 둔 서버면 그리지 않는다.
 * 무엇을 남기는지는 방침(Policy.tsx "서버가 날마다 만드는 기록")과 같은 말로 (0.45.0 D3). `days` 는 날짜 차이가 아니라
 * 쌓인 **줄 수**라 "○일째"가 아니라 "○일치". 쌓인 것을 볼 화면은 아직 없다고 적는다 — 볼 곳이 있는 것처럼 읽히지 않게.
 */
export function ValueRecordLine({ record }: { record: ValueRecord | null | undefined }) {
  if (!record?.enabled) return null
  return (
    <p className="hint value-record-line">
      이와 따로 서버가 매일 아침 평가금액과 보유 모습을 남깁니다.{' '}
      {record.days > 0 && record.since ? (
        <>
          {/* 날짜가 줄 끝에서 "2026-" / "10-12" 로 갈라지지 않게 */}
          {/* "(쌓인 기록을 보는 화면은 아직 없습니다)"는 뺐다 — 할 수 없는 일을 알려 헷갈렸다(묶음 4 사용자 확인 2) */}
          <span className="nowrap">{record.since}부터</span> <span className="nowrap">{record.days}일치</span> 쌓였습니다.
        </>
      ) : (
        '보유나 현금이 있으면 다음 아침부터 쌓입니다.'
      )}
    </p>
  )
}

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
        아직 기록이 없습니다. 리뷰 날 "현재 상태 기록"을 누르면 그날의 수량, 가격, 비중이 남아 다음 리뷰 때
        비교할 수 있습니다.
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
                {snapshot.review_date && `리뷰 마감 ${snapshot.review_date} 기준, `}
                {pnl !== null && `평가손익 ${signedAmount(pnl, base)}, `}
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

/** 주문의 주수 → 거래 칸의 처음 값. 제목과 같은 정수 주(1주 미만이면 소수 그대로) */
function tradeQtyOf(shares: number | null): string {
  if (shares === null) return ''
  const exact = Number(Math.abs(shares).toFixed(2))
  const whole = Math.floor(exact)
  return String(whole === 0 ? exact : whole)
}

/**
 * 주문 옆 "거래 입력" — 주문 가이드를 보고 산·판 것을 그 자리에서 반영한다 (디자인 2차, 주인 결정 ②).
 * 예전에는 아래 "보유 · 목표 비중"까지 내려가 그 종목을 다시 찾아야 했다. 같은 거래 칸(TradeForm)을 쓴다.
 */
function OrderTrade({
  row,
  order,
  fxNow,
  onSaved,
  onError,
}: {
  row: Row
  order: OrderLine
  fxNow: number | null
  onSaved: (done?: { side: TradeSide; qty: number }) => void
  onError: (e: unknown) => void
}) {
  const [open, setOpen] = useState(false)
  const formRef = useRef<HTMLDivElement>(null)
  // 폰 320 에서 거래 칸이 시트 아래 화면 밖에 열려 "아무 일도 안 일어난 것"처럼 보였다 — 연 칸을 보이는 곳으로 (묶음 4 사용자 확인 2)
  useEffect(() => {
    if (open) formRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }, [open])
  if (order.action === 'hold') return null
  return (
    <>
      <button
        className="sm order-trade-toggle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={open ? `${shortLabel(row)} 거래 칸 닫기` : `${shortLabel(row)} 거래 입력`}
      >
        {open ? '거래 칸 닫기' : '거래 입력'}
      </button>
      {open && (
        <div ref={formRef} className="order-trade-form">
        <TradeForm
          row={row}
          fxNow={fxNow}
          initialSide={order.action === 'sell' ? 'sell' : 'buy'}
          initialQty={tradeQtyOf(order.shares)}
          onSaved={onSaved}
          onError={onError}
          onClose={() => setOpen(false)}
        />
        </div>
      )}
    </>
  )
}

/** PC 주문 표의 한 줄 — 끝에 "거래 입력", 누르면 바로 아래 줄에 거래 칸 (보유 표와 같은 꼴) */
function OrderTableRow({
  row,
  order,
  fxNow,
  columns,
  onSaved,
  onError,
  children,
}: {
  row: Row
  order: OrderLine
  fxNow: number | null
  columns: number
  onSaved: (done?: { side: TradeSide; qty: number }) => void
  onError: (e: unknown) => void
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <tr>
        {children}
        <td>
          {order.action !== 'hold' && (
            <button
              className="sm order-trade-toggle"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              aria-label={open ? `${shortLabel(row)} 거래 칸 닫기` : `${shortLabel(row)} 거래 입력`}
            >
              {open ? '거래 칸 닫기' : '거래 입력'}
            </button>
          )}
        </td>
      </tr>
      {open && (
        <tr className="trade-row">
          <td colSpan={columns}>
            <TradeForm
              row={row}
              fxNow={fxNow}
              initialSide={order.action === 'sell' ? 'sell' : 'buy'}
              initialQty={tradeQtyOf(order.shares)}
              onSaved={onSaved}
              onError={onError}
              onClose={() => setOpen(false)}
            />
          </td>
        </tr>
      )}
    </>
  )
}

/**
 * 주문 옆의 신호 — 주문과 다른 것임이 보이게 이름표를 붙인다 (디자인 2차).
 * "사기" 카드에 "▼ 기간 내 매도"가, "사기" 바로 아래 "밴드 이내"가 이름표 없이 붙어 있어 무엇을 하라는지 헤맸다.
 * 비중조절 신호는 "비중", 매도 시그널은 "참고"(실제 매도는 리뷰 때 비중으로 정한다).
 */
function SignalBadges({ current }: { current: RebalanceRow }) {
  const reasons = current.rebalance_signal.reasons
  return (
    <div className="badge-row signal-badges">
      {reasons.length > 0 && (
        <span className="badge-group">
          <span className="badge-group-label">비중</span>
          {reasons.map((r) => (
            <ReasonTag key={r} reason={r} />
          ))}
        </span>
      )}
      {current.shoulder_signal_fired_in_period && (
        <span className="badge-group">
          <span className="badge-group-label">참고</span>
          {/* 참고 꼬리표는 회색 — 빨강이면 "늘릴 종목" 줄에서 팔라는 말로 읽혔다(② 주인 답, 사용자 확인 2) */}
          <span className="badge badge-grey badge-nowrap" title="이번 리뷰 기간에 매도 시그널(참고)이 한 번 이상 떴습니다.">
            <SignalShape kind="sell" size={9} />
            기간 내 매도
          </span>
        </span>
      )}
      {!current.rebalance_signal.active && !current.shoulder_signal_fired_in_period && (
        <span className="hint" title="비중이 밴드 안이라 비중조절 신호가 없습니다. 주문은 목표에 맞춘 참고입니다.">
          비중조절 신호 없음
        </span>
      )}
    </div>
  )
}

/* ---------- 화면 ---------- */

const BUY_ONLY_KEY = 'rebalance.buy-only'

export function RebalancePanel() {
  const { refreshKey, notifyDataChanged } = useAppState()
  usePrefs() // 금액 가리기를 바꾸면 주문 가이드·기록까지 다시 그린다 (ROADMAP 9-3)
  const { isAdmin } = useAuth()
  const narrow = useNarrow()
  // 본문이 좁은 PC(확대 150% 등)는 6열 표의 오른쪽이 잘린다 — 그 폭에서는 폰과 같은 줄 묶음 (사용자 확인 4)
  const compact = useMedia('(max-width: 1100px)') || narrow
  const [rows, setRows] = useState<Row[]>([])
  const [current, setCurrent] = useState<RebalanceCurrent | null>(null)
  // 주문 옆 거래 입력으로 반영한 뒤 한 줄 — 주문 가이드가 곧바로 다시 계산되어 "606주 사기"가 "109주 사기"로,
  // 다른 종목의 사기가 팔기로 바뀌는데 이유가 없었다 (디자인 2차 C 사용자 확인)
  const [tradeNote, setTradeNote] = useState<string | null>(null)
  // 디자인 4차 목업 12c — 줄을 누르면 연 종목 · 목표 · 밴드 시트 · 폰의 새로 넣을 돈 · 유지 펼침
  const [openTicker, setOpenTicker] = useState<string | null>(null)
  const [targetsOpen, setTargetsOpen] = useState(false)
  const [moneyOpen, setMoneyOpen] = useState(false)
  const [holdOpen, setHoldOpen] = useState(false)
  const [targetNote, setTargetNote] = useState<string | null>(null)
  // 저장할 때마다 하나씩 — 같은 줄 수면 글이 같아 저장 줄을 다시 끌어오지 않았다(묶음 4 검토 8 조건 1)
  const [targetSaves, setTargetSaves] = useState(0)
  // 목업 12d A — 리뷰 · 기록과 설정은 화면 밖(시트)에서 연다. 화면에는 주문과 목록 한 장만
  const [recordsOpen, setRecordsOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [snapshots, setSnapshots] = useState<RebalanceSnapshot[]>([])
  const [bandInput, setBandInput] = useState('')
  const [error, setError] = useState<unknown>(null)

  /** 통화별로 직접 입력한 환율 (빈 문자열이면 자동 조회값을 쓴다) */
  const [fxInputs, setFxInputs] = useState<Partial<Record<Currency, string>>>({})
  const [fxBusy, setFxBusy] = useState(false)

  /** 이번에 새로 넣을 돈 (계산만 한다 — 저장하지 않는다) */
  const [newMoney, setNewMoney] = useState('')
  // 팔지 않고 새 돈만 나누기 (0.42.0) — 기본은 꺼짐(지금과 같은 계산). 기기에 기억한다
  const [buyOnly, setBuyOnlyState] = useState(() => {
    try {
      return localStorage.getItem(BUY_ONLY_KEY) === '1'
    } catch {
      return false
    }
  })
  const setBuyOnly = (on: boolean) => {
    setBuyOnlyState(on)
    try {
      localStorage.setItem(BUY_ONLY_KEY, on ? '1' : '0')
    } catch {
      // 저장이 막힌 브라우저 — 이번에만 쓴다
    }
  }

  /** 보유·목표 칸에서 고치는 중인 값 */
  const [drafts, setDrafts] = useState<Record<string, HoldingDraft>>({})
  const [saving, setSaving] = useState(false)
  // 환율 효과 켜기 — 누르는 즉시 표시를 바꾼다(저장 뒤 다시 받을 때까지 기다리면 눌러도 안 바뀐 것 같다)
  const [fxEffectDraft, setFxEffectDraft] = useState<boolean | null>(null)
  // 저장에 실패한 줄은 다시 받아 와도 고치던 값을 남긴다 — 나머지 줄만 서버 값으로 돌아간다
  const keepDrafts = useRef<Record<string, HoldingDraft>>({})
  // 저장하지 않은 목표 · 밴드 — 다시 받아 올 때(거래 반영 · 새로고침) 남기려고 그릴 때마다 지금 값을 쥔다
  const unsavedRef = useRef<Record<string, HoldingDraft>>({})

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
      // 고치던 목표 · 밴드는 다시 받아 와도 남긴다 — 실패한 줄, 그리고 저장하지 않고 시트를 닫은 채 거래를 반영한 줄(묶음 4 검토 조건 6).
      // 수량 · 평단가 · 매수 환율은 리밸런싱에서 고치지 않으니 서버 값으로 — 옛 수량을 다시 보내지 않게
      const kept = { ...unsavedRef.current, ...keepDrafts.current }
      setDrafts(
        Object.fromEntries(
          nextRows.map((r) => {
            const fresh = draftOf(r)
            const k = kept[r.ticker]
            return [r.ticker, k ? { ...fresh, target: k.target, band: k.band } : fresh]
          }),
        ),
      )
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
  const orderSaved = (row: Row) => (done?: { side: TradeSide; qty: number }) => {
    if (done)
      setTradeNote(
        `${shortLabel(row)} ${done.qty.toLocaleString('ko-KR')}주 ${done.side === 'buy' ? '산' : '판'} 것을 반영했습니다. 주문 가이드를 바뀐 보유로 다시 계산했습니다. 남은 주문이 줄거나 다른 종목의 사기·팔기가 바뀔 수 있습니다.${done.side === 'sell' ? ' 판 돈은 현금에 저절로 더해지지 않습니다. "리밸런싱 설정"의 "현금"에 적으면 전체 자금에 들어갑니다.' : ''}`,
      )
    handleSaved()
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

  useEffect(() => {
    unsavedRef.current = Object.fromEntries(dirtyTickers.map((t) => [t, drafts[t]]))
  }, [dirtyTickers, drafts])

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
    // 저장한 줄은 서버 값으로 돌아오게 — 남길 것은 실패한 줄만
    unsavedRef.current = {}
    keepDrafts.current = Object.fromEntries(failed.map((t) => [t, drafts[t]]))
    setSaving(false)
    const firstError = results.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined
    notifyDataChanged()
    if (firstError) setError(firstError.reason)
    const saved = dirtyTickers.length - failed.length
    setTargetNote(saved > 0 ? `${saved}줄을 저장했습니다. 주문 가이드를 새 목표로 다시 계산했습니다.` : null)
    setTargetSaves((n) => n + 1)
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
        buyOnly,
      ),
    [rows, baseCurrency, fx, cash, newMoney, buyOnly],
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

  /** 매수 환율 칸 — 외화 종목이 하나라도 있을 때만 */
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
      // 누를 곳이 없었다 — 폰은 종목 관리가 "더보기" 안이다 (디자인 2차, 주인 결정). 차트·재무도 같은 말·단추로 (0.45.0 D5)
      <NoStocksYet title="리밸런싱할 종목이 없습니다" shows="목표 비중과 지금 비중이" />
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
      {/* 예전 글 "모자란 종목부터 채우는 주문"은 실제(전체를 다시 맞춘다, 명세 6.4)와 달랐다 (0.42.0) */}
      <span className="hint">
        {/* 계산에 쓴 금액을 칸 바로 아래에도 — 폰에서는 위의 반영 줄이 치는 동안 화면 밖이었다(0.45.2 A4). 읽기는 위 줄(status)만 */}
        {plan.newMoney > 0 && (
          <>
            새로 넣을 돈 <b>{amount(plan.newMoney, baseCurrency)}</b> 반영.{' '}
          </>
        )}
        {buyOnly
          ? '팔지 않고, 새로 넣을 돈만 목표에 모자란 만큼에 비례해 나눕니다. 저장되지 않습니다.'
          : '새로 넣을 돈까지 더한 전체 자금으로 목표 비중을 다시 맞춘 주문이 나옵니다(파는 주문도 있을 수 있습니다). 저장되지 않습니다.'}
      </span>
      <label className="check-line">
        <input type="checkbox" checked={buyOnly} onChange={(e) => setBuyOnly(e.target.checked)} />
        팔지 않고 새 돈만 나누기
      </label>
    </div>
  )

  /** PC 요약 띠의 새로 넣을 돈 칸 (디자인 5차 목업 05 가) — 긴 풀이는 빼고, 넣으면 표 위 한 줄이 무엇을 했는지 말한다 */
  const newMoneyCell = (
    <>
      <label className="rb-strip-k" htmlFor="new-money">
        이번에 새로 넣을 돈
      </label>
      <div className="rb-strip-v rb-money-line">
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
        <label
          className="check-line"
          title="켜면 팔지 않고, 새로 넣을 돈만 목표에 모자란 만큼에 비례해 나눕니다. 끄면 새로 넣을 돈까지 더한 전체 자금으로 목표 비중을 다시 맞춥니다. 저장되지 않습니다."
        >
          <input type="checkbox" checked={buyOnly} onChange={(e) => setBuyOnly(e.target.checked)} />
          팔지 않고 새 돈만 나누기
        </label>
      </div>
    </>
  )

  /** 사거나 팔 주문 수 — 유지는 빼고 (디자인 2차: 머리말이 "비중조절 신호 3종목"뿐이라 주문 14개와 어긋나 보였다) */
  const orderCount = plan.orders.filter((o) => o.action !== 'hold').length
  // 목표 0% 라서 생긴 팔기 (0.45.4 C) — 하나면 그 줄에 풀이, 둘 이상이면 위에 한 줄로 모으고 줄마다는 짧게
  const zeroSells = plan.orders.filter((o) => {
    const r = rowByTicker.get(o.ticker)?.current
    return !!r && isZeroTargetSell(o, r.target_weight_pct)
  }).length
  const zeroSummary = zeroTargetSummary(zeroSells)
  const zeroNote = (o: OrderLine, targetPct: number) =>
    isZeroTargetSell(o, targetPct) ? (
      <p className="hint zero-target-note">{zeroSummary ? ZERO_TARGET_SHORT : ZERO_TARGET_NOTE}</p>
    ) : null

  /** 새 돈만 나누기에서 1주도 안 되는 몫 — 소수 주를 못 사는 증권사면 실제로는 사지 못한다 (B 사용자 확인) */
  const underOne = plan.buyOnly
    ? plan.orders.filter((o) => o.action === 'buy' && o.shares !== null && Math.abs(o.shares) < 1).length
    : 0

  /** 새로 넣을 돈이 어디로 갔는지 한 줄 — 주문 가이드 맨 위 */
  const newMoneyLine =
    plan.newMoney > 0 ? (
      <p className="new-money-line" role="status">
        새로 넣을 돈 <b>{amount(plan.newMoney, baseCurrency)}</b>{' '}
        {plan.buyOnly
          ? `— 목표에 모자란 만큼에 비례해 나눴습니다${plan.leftover > 0.5 ? ` (남는 ${amount(plan.leftover, baseCurrency)}은 현금)` : ''}${
              underOne > 0 ? `, ${underOne}종목은 1주 미만이라 소수 주를 못 사면 그 몫이 현금에 남습니다` : ''
            }`
          : '반영. 전체 자금으로 목표 비중을 다시 맞춘 주문입니다'}
      </p>
    ) : null

  /* ---------- 디자인 4차 목업 12c — 줄일/늘릴 묶음, 부호 주수 + 왼쪽 띠, 누르면 시트 ---------- */

  /** 줄에는 정수 주만 — 소수 주(1,638.42)는 이름을 밀어내 시트에만 (12c 앱 확인). 1주 미만은 그대로 "1주 미만 (0.06주)" */
  const rowShares = (order: OrderLine) => {
    if (order.action === 'hold') return '—'
    if (order.shares === null) return `${signedAmount(order.adjustNative, order.currency)}어치`
    const whole = Math.floor(Number(Math.abs(order.shares).toFixed(2)))
    if (whole === 0) return sharesText(order.shares, true)
    return `${order.shares > 0 ? '+' : '−'}${whole.toLocaleString('ko-KR')}주`
  }
  const weightNowOf = (row: Row) => (plan.total > 0 ? (row.current.current_value_base / plan.total) * 100 : 0)
  const itemOf = (order: OrderLine): OrderRowItem | null => {
    const row = rowByTicker.get(order.ticker)
    if (!row) return null
    const label = shortLabel(row)
    return {
      ticker: order.ticker,
      label,
      action: order.action,
      shares: rowShares(order),
      money: signedAmount(order.adjust, baseCurrency),
      weights: `${num(weightNowOf(row), 1)}% → ${num(row.current.target_weight_pct, 0)}%`,
      weightSignal: row.current.rebalance_signal.active,
      spoken: [
        orderTitle(label, order),
        `비중 ${num(weightNowOf(row), 1)}%에서 목표 ${num(row.current.target_weight_pct, 0)}%`,
        row.current.rebalance_signal.active ? '비중이 밴드 밖' : '',
        order.action === 'hold' ? '' : signedAmount(order.adjust, baseCurrency),
      ]
        .filter(Boolean)
        .join(', '),
    }
  }
  // 큰 것부터 — 무엇을 먼저 할지 (목업 12c). 계산은 그대로, 보이는 순서만
  const bySize = (a: OrderLine, b: OrderLine) => Math.abs(b.adjust) - Math.abs(a.adjust)
  const sells = plan.orders.filter((o) => o.action === 'sell').sort(bySize)
  const buys = plan.orders.filter((o) => o.action === 'buy').sort(bySize)
  const holds = plan.orders.filter((o) => o.action === 'hold')
  const sellTotal = -sells.reduce((s, o) => s + o.adjust, 0)
  const buyTotal = buys.reduce((s, o) => s + o.adjust, 0)
  const items = (orders: OrderLine[]) => orders.map(itemOf).filter((i): i is OrderRowItem => i !== null)

  const openOrder = openTicker ? plan.orders.find((o) => o.ticker === openTicker) : undefined
  const openRow = openTicker ? rowByTicker.get(openTicker) : undefined

  /** 목업 12d α — 세 카드 대신 목록 한 장(설정 탭처럼). 오른쪽에 지금 값 */
  const moreList = (
    <ul className="rb-list" aria-label="리밸런싱 더 보기">
      <li>
        <button type="button" onClick={() => setTargetsOpen(true)}>
          <Icon name="edit" />
          <span>목표 수정</span>
          <small className="mono">합계 {num(plan.targetSum, 1)}%</small>
          <Icon name="forward" size={18} className="rb-list-go" />
        </button>
      </li>
      <li>
        <button type="button" onClick={() => setRecordsOpen(true)}>
          <Icon name="doc" />
          <span>리뷰 기록</span>
          <small className="mono">
            {reviewCountdown(current.review)}, {snapshots.length}건
          </small>
          <Icon name="forward" size={18} className="rb-list-go" />
        </button>
      </li>
      <li>
        <button type="button" onClick={() => setSettingsOpen(true)}>
          <Icon name="settings" />
          <span>리밸런싱 설정</span>
          <small>주기, 현금, 환율, 밴드</small>
          <Icon name="forward" size={18} className="rb-list-go" />
        </button>
      </li>
    </ul>
  )

  const newMoneyToggle = (
    <button
      type="button"
      className="rb-line"
      aria-expanded={moneyOpen}
      aria-controls={moneyOpen ? 'new-money-block' : undefined}
      onClick={() => {
        setMoneyOpen((o) => !o)
        // 펼친 칸의 "팔지 않고 새 돈만 나누기"가 아래 탭 뒤에 걸렸다(사용자 확인 4) — 칸 전체가 보이게
        requestAnimationFrame(() =>
          document.getElementById('new-money-block')?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }),
        )
      }}
    >
      <span>새로 넣을 돈</span>
      <b className="mono">{plan.newMoney > 0 ? amount(plan.newMoney, baseCurrency) : `0${CURRENCY_META[baseCurrency].label}`}</b>
      {plan.buyOnly && <span className="hint">팔지 않고 나누기</span>}
      <Icon name="forward" size={18} className={`rb-line-go${moneyOpen ? ' open' : ''}`} />
    </button>
  )

  /** PC 비중 차이 칩 — 밴드 밖이면 많음(줄일 색) · 적음(늘릴 색), 안이면 회색 (목업 12d 3 세 칸, 주인: "막대가 와닿지 않아") */
  const driftChip = (row: Row) => {
    const d = weightNowOf(row) - row.current.target_weight_pct
    const tone = row.current.rebalance_signal.active ? (d > 0 ? 'over' : 'under') : 'ok'
    return <span className={`drift-chip ${tone} mono`}>{signed(d, 1, '%p')}</span>
  }

  const tableRow = (order: OrderLine) => {
    const row = rowByTicker.get(order.ticker)
    if (!row) return null
    const native = order.currency
    const isForeign = native !== baseCurrency
    const now = weightNowOf(row)
    return (
      <OrderTableRow
        key={row.ticker}
        row={row}
        order={order}
        fxNow={fxNowOf(native)}
        columns={8}
        onSaved={orderSaved(row)}
        onError={setError}
      >
        <td>
          {/* 한 줄 (디자인 5차 목업 05 가) — 수량 · 가격 · 평가는 이름에 마우스를 올리면 */}
          <div
            className={`ticker-cell order-stripe is-${order.action}`}
            title={[
              labelOf(row) !== row.ticker ? row.ticker : '',
              `${qty(row.current.quantity)}주`,
              price(row.current.last_close, native),
              `평가 ${amount(row.current.current_value_base, baseCurrency)}`,
              isForeign ? `현지 ${amount(row.current.current_value, native)}` : '',
            ]
              .filter(Boolean)
              .join(', ')}
          >
            <div className="stock-line">
              <span className="ticker-name">{labelOf(row)}</span>
              {row.stock?.category && <span className="rb-kind">{row.stock.category}</span>}
            </div>
          </div>
        </td>
        <td className="num-cell mono">{num(now, 1)}%</td>
        <td className="num-cell mono">{num(row.current.target_weight_pct, 0)}%</td>
        <td className="num-cell">{driftChip(row)}</td>
        <td
          className={`num-cell order-shares tone-${order.action}`}
          aria-label={orderTitle(shortLabel(row), order)}
          title={isZeroTargetSell(order, row.current.target_weight_pct) ? ZERO_TARGET_NOTE : undefined}
        >
          {rowShares(order)}
          {/* 한 줄을 지키려고 목표 0% 풀이는 짧게, 긴 말은 마우스를 올리면 */}
          {isZeroTargetSell(order, row.current.target_weight_pct) && <small className="zero-target-note rb-zero"> {ZERO_TARGET_SHORT}</small>}
        </td>
        <td
          className={`num-cell mono${order.adjust > 0 ? ' tone-buy' : order.adjust < 0 ? ' tone-sell' : ''}`}
          title={[
            isForeign && order.action !== 'hold' ? `주문 ${signedAmount(order.adjustNative, native)}` : '',
            `목표 ${amount(order.targetValue, baseCurrency)}`,
          ]
            .filter(Boolean)
            .join(', ')}
        >
          {order.action === 'hold' ? '—' : signedAmount(order.adjust, baseCurrency)}
        </td>
        <td className="rb-sig-cell">
          {/* 신호는 둘만: 밴드 밖은 차이 칸 색, 매도 신호는 이 칸 (목업 05) */}
          {row.current.shoulder_signal_fired_in_period ? (
            <span className="rb-sell-mark" title={`${PERIOD_NOW[current.review.period]} 어깨매도 시그널(참고)이 한 번 이상 떴습니다. 주문 수량과는 상관없습니다.`}>
              있음
            </span>
          ) : (
            <span className="hint">—</span>
          )}
        </td>
      </OrderTableRow>
    )
  }
  // 묶음 소제목 — 매도 · 매수는 색, 개수는 옅게 (주인: 대제목과 구분이 안 된다)
  const groupRow = (title: string, orders: OrderLine[] | null, kind: 'sell' | 'buy' | 'hold' | 'cash') =>
    (orders === null || orders.length > 0) && (
      <tr className={`order-group-row is-${kind}`}>
        <th colSpan={8} scope="colgroup">
          {title}
          {orders && ' '}
          {orders && <span className="order-group-count">{orders.length}종목</span>}
        </th>
      </tr>
    )

  // 시트의 합계는 치는 값을 따라간다 — 저장된 합계(plan.targetSum)를 보여 +10 을 쳐도 90% 그대로였다(묶음 4 검토 조건 6)
  const draftSum =
    rows.reduce((sum, r) => sum + (Number((drafts[r.ticker] ?? draftOf(r)).target) || 0), 0) + plan.cash.targetPct
  const draftOk = Math.abs(draftSum - 100) < 0.01

  const targetLines: TargetLine[] = rows.map((row) => {
    const draft = drafts[row.ticker] ?? draftOf(row)
    return {
      ticker: row.ticker,
      label: shortLabel(row),
      sub: `${qty(row.current.quantity)}주, 현재 ${num(weightNowOf(row), 1)}%`,
      qty: `${qty(row.current.quantity)}주`,
      now: `${num(weightNowOf(row), 1)}%`,
      target: draft.target,
      band: draft.band,
      dirty: changesOf(row, draft).target,
    }
  })

  return (
    <div className="rebalance">
      {compact ? (
      <div className="page-head rb-head">
        <div>
          <h2>리밸런싱</h2>
          <PageIntro
            line={
              <>
                목표는 <b>현금을 포함한 전체 자금</b> 중의 비중입니다.
              </>
            }
            firstVisit={loading ? null : rows.length === 0}
          >
            주문은 지금 가격으로 목표 비중에 맞추려면 무엇을 얼마나 사고팔지 보여주는 참고입니다(−는 줄이기, +는 늘리기). 실제로
            사고파는 것은 리뷰 때 정합니다. 줄을 누르면 자세히와 거래 입력이, &ldquo;목표 수정&rdquo;에서 목표 비중을 한 번에 고칩니다.
          </PageIntro>
        </div>
        <button type="button" className="rb-pill rb-review" onClick={() => setRecordsOpen(true)}>
          다음 리뷰 <b className="mono">{reviewCountdown(current.review)}</b>
        </button>
      </div>
      ) : (
        // PC 머리 (디자인 5차 목업 05 가) — 제목 옆 다음 리뷰, 도구는 오른쪽 위 글 단추
        <div className="page-head rb-head rb-head-pc">
          <h2>
            리밸런싱
            <button type="button" className="rb-review-chip" onClick={() => setRecordsOpen(true)}>
              다음 리뷰 <b className="mono">{reviewCountdown(current.review)}</b>
            </button>
          </h2>
          <div className="rb-tools">
            <button type="button" onClick={() => setTargetsOpen(true)}>
              목표 수정
            </button>
            <button type="button" onClick={() => setRecordsOpen(true)}>
              리뷰 기록
            </button>
            <button type="button" onClick={() => setSettingsOpen(true)}>
              설정
            </button>
          </div>
        </div>
      )}

      <ErrorNotice error={error} onDismiss={() => setError(null)} />

      {fx?.is_estimate && hasMixedCurrencies && (
        <div className="callout amber">
          <span className="ico">⚠</span>
          <div>
            환율을 받아오지 못해 추정치로 계산하고 있습니다
            {estimatedCurrencies.length > 0 && ` (${estimatedCurrencies.join(', ')})`}. 통화가 섞인
            포트폴리오라 비중이 실제와 다를 수 있으니, "리밸런싱 설정"의 "적용 환율"에서 직접 입력하거나 다시
            조회해주세요.
          </div>
        </div>
      )}

      {compact ? (
      <div className="rb-top">
        <RebalanceSummary
          total={amount(current.total_value_base, baseCurrency)}
          cash={amount(cash?.value_base ?? 0, baseCurrency)}
          band={`±${num(settings?.default_rebalance_band_pct ?? 0, 1)}%p`}
          targetSum={`${num(plan.targetSum, 1)}%`}
          targetOk={targetOk}
          notes={`현금 포함, ${CURRENCY_META[baseCurrency].label} 기준${plan.cash.targetPct > 0 ? `, 현금 목표 ${num(plan.cash.targetPct, 0)}%` : ''}`}
          onTargets={() => setTargetsOpen(true)}
        />
        {!narrow && (
          <div className="rb-money-box" id="new-money-block">
            {newMoneyBlock}
          </div>
        )}
      </div>
      ) : (
        <RebalanceStrip
          total={amount(current.total_value_base, baseCurrency)}
          sellCount={sells.length}
          sellText={signedAmount(-sellTotal, baseCurrency)}
          buyCount={buys.length}
          buyText={signedAmount(buyTotal, baseCurrency)}
          targetSum={`${num(plan.targetSum, 1)}%`}
          targetGap={targetOk ? null : plan.targetSum < 100 ? `${num(100 - plan.targetSum, 1)}%p 비어 있음` : `${num(plan.targetSum - 100, 1)}%p 넘침`}
          onTargets={() => setTargetsOpen(true)}
          money={newMoneyCell}
        />
      )}

      {/* 저장하지 않고 시트를 닫으면 아무 표시가 없었다(묶음 4 검토 조건 6) */}
      {!targetsOpen && dirtyTickers.length > 0 && (
        <p className="rb-unsaved" role="status">
          목표 수정에 저장하지 않은 변경 {dirtyTickers.length}줄 ({dirtyTickers.map((t) => shortLabel(rowByTicker.get(t)!)).join(', ')}){' '}
          <button type="button" className="link-like" onClick={() => setTargetsOpen(true)}>
            열어서 저장
          </button>
        </p>
      )}


      <section className="section rb-orders" aria-label="주문 가이드">
        {compact && (
        <div className="section-head">
          <h3 id="orders-title">주문 가이드</h3>
          <span className="hint">
            주문 {orderCount}, 비중조절 신호 {signalled.length}종목, {plan.buyOnly ? '나눈 몫이 새로 넣을 돈의' : '조정 금액이 전체의'}{' '}
            {NOISE_THRESHOLD_PCT}% 미만이면 &ldquo;유지&rdquo;
          </span>
        </div>
        )}
        {compact && (
        <OrderSplit
          money={
            narrow ? (
              <>
                {newMoneyToggle}
                {moneyOpen && <div id="new-money-block">{newMoneyBlock}</div>}
              </>
            ) : undefined
          }
          sellCount={sells.length}
          buyCount={buys.length}
          holdCount={holds.length}
          sellTotal={sellTotal}
          buyTotal={buyTotal}
          sellText={signedAmount(-sellTotal, baseCurrency)}
          buyText={signedAmount(buyTotal, baseCurrency)}
        />
        )}
        {newMoneyLine}
        {tradeNote && (
          <p className="new-money-line" role="status">
            {tradeNote}
          </p>
        )}
        {zeroSummary && (
          <p className="hint zero-target-note" role="note">
            {zeroSummary}
          </p>
        )}
        {compact ? (
          <>
            <OrderGroup
              title="줄일 종목"
              tone="sell"
              total={signedAmount(-sellTotal, baseCurrency)}
              items={items(sells)}
              limit={3}
              onOpen={setOpenTicker}
            />
            <OrderGroup
              title="늘릴 종목"
              tone="buy"
              total={signedAmount(buyTotal, baseCurrency)}
              items={items(buys)}
              limit={3}
              onOpen={setOpenTicker}
            />
            {holds.length > 0 && (
              <div className="order-group">
                <button
                  type="button"
                  className="rb-line rb-holds"
                  aria-expanded={holdOpen}
                  onClick={() => setHoldOpen((o) => !o)}
                >
                  <span>
                    유지 {holds.length}
                    {plan.buyOnly && ' (팔지 않고 나누기라 줄일 종목도 여기)'}, {holds.map((o) => (rowByTicker.get(o.ticker) ? shortLabel(rowByTicker.get(o.ticker)!) : o.ticker)).join(', ')}
                  </span>
                  <Icon name="forward" size={18} className={`rb-line-go${holdOpen ? ' open' : ''}`} />
                </button>
                {holdOpen && (
                  <ul className="order-card">
                    {items(holds).map((item) => (
                      <OrderRowButton key={item.ticker} item={item} onOpen={setOpenTicker} />
                    ))}
                  </ul>
                )}
              </div>
            )}
            <div className="order-group">
              <div className="order-card cash-card">
                <div className="order-row is-hold static">
                  <span className="order-row-name">
                    <span className="order-row-title">현금</span>
                    <span className="order-row-sub mono">목표 {num(plan.cash.targetPct, 0)}%</span>
                  </span>
                  <span className="order-row-act">
                    {/* 새 돈만 나누기면 산 뒤 실제로 남는 현금 — 목표가 아니다 (B 검토 D4) */}
                    <span className="mono">
                      {amount(plan.cash.current, baseCurrency)} →{' '}
                      {amount(plan.buyOnly ? plan.cash.current + plan.cash.adjust : plan.cash.targetValue, baseCurrency)}
                      {plan.buyOnly && ' 남음'}
                    </span>
                    {underOne > 0 && <span className="hint">1주 미만 {underOne}종목을 못 사면 그만큼 더 남음</span>}
                  </span>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="table-scroll">
            <table className="data-table sticky-first order-table">
              <thead>
                <tr>
                  <th style={{ minWidth: 220 }}>종목</th>
                  <th className="num-cell" style={{ minWidth: 64 }}>현재</th>
                  <th className="num-cell" style={{ minWidth: 56 }}>목표</th>
                  <th className="num-cell" style={{ minWidth: 80 }} title="색이 있으면 비중이 밴드 밖">차이</th>
                  <th className="num-cell" style={{ minWidth: 110 }}>주문</th>
                  <th className="num-cell" style={{ minWidth: 150 }}>금액</th>
                  <th style={{ minWidth: 110 }} title="어깨매도 시그널(참고)이 이 기간에 한 번이라도 떴는지. 주문 수량과는 상관없습니다.">
                    {PERIOD_NOW[current.review.period]} 매도 시그널
                  </th>
                  {/* 열린 "거래 칸 닫기"(한 줄) 폭까지 처음부터 — 열 때 열이 96 → 100px 로 넓어져 다른 칸이 꺾였다(검토 9 조건 1) */}
                  <th style={{ minWidth: 104 }}>
                    <span className="sr-only">거래</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {groupRow('매도', sells, 'sell')}
                {sells.map(tableRow)}
                {groupRow('매수', buys, 'buy')}
                {buys.map(tableRow)}
                {groupRow('유지', holds, 'hold')}
                {holds.map(tableRow)}
                {groupRow('현금', null, 'cash')}
                <tr className="cash-row">
                  <td>
                    <div
                      className="ticker-cell"
                      title={plan.newMoney > 0 ? `현재 ${amount(cash?.value_base ?? 0, baseCurrency)} + 새로 넣을 돈` : undefined}
                    >
                      <div className="stock-line">
                        <span className="ticker-name">예수금</span>
                      </div>
                    </div>
                  </td>
                  <td className="num-cell mono">{num(plan.total > 0 ? (plan.cash.current / plan.total) * 100 : 0, 1)}%</td>
                  <td className="num-cell mono">{num(plan.cash.targetPct, 0)}%</td>
                  <td />
                  <td />
                  <td
                    className={`num-cell mono ${plan.cash.adjust > 0 ? 'tone-buy' : plan.cash.adjust < 0 ? 'tone-sell' : ''}`}
                    title={`${amount(plan.cash.current, baseCurrency)} → ${amount(plan.cash.targetValue, baseCurrency)}. ${
                      plan.cash.adjust < 0
                        ? '목표보다 많은 현금, 매수 재원입니다.'
                        : plan.cash.adjust > 0
                          ? '목표보다 적은 현금, 매도 대금이 여기로 옵니다.'
                          : '목표와 같습니다.'
                    }`}
                  >
                    {signedAmount(plan.cash.adjust, baseCurrency)}
                  </td>
                  <td colSpan={2} />
                </tr>
              </tbody>
              <tfoot>
                <tr>
                  <td>합계</td>
                  <td colSpan={4} />
                  <td className="num-cell mono">
                    {signedAmount(plan.orders.reduce((s, o) => s + o.adjust, 0) + plan.cash.adjust, baseCurrency)}
                  </td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        {compact && moreList}
        <p className="hint rb-foot">지금 가격으로 목표에 맞추는 참고입니다. 실제로 사고파는 것은 리뷰 때 정합니다.</p>
      </section>

      {openOrder && openRow && (
        <Sheet
          title={shortLabel(openRow)}
          label={`${shortLabel(openRow)} 주문 자세히`}
          closeLabel="자세히 닫기"
          className="order-sheet"
          onClose={() => setOpenTicker(null)}
          sub={
            <>
              {openRow.stock?.category && <>구분 {openRow.stock.category}, </>}
              {qty(openRow.current.quantity)}주, {price(openRow.current.last_close, openRow.current.currency)}
            </>
          }
        >
          <div className={`order-sheet-act is-${openOrder.action}`}>
            <b className="mono">
              {openOrder.action === 'hold' ? '유지' : rowShares(openOrder)}
              {/* 괄호 소수가 무엇인지 몰랐다(사용자 확인 4) — 계산한 소수 주는 따로 한 줄로 */}
              {openOrder.action !== 'hold' &&
                openOrder.shares !== null &&
                Math.abs(openOrder.shares) >= 1 &&
                !Number.isInteger(Number(Math.abs(openOrder.shares).toFixed(2))) && (
                  <small className="hint">계산으로는 {num(Math.abs(openOrder.shares), 2)}주, 1주 단위로 내림</small>
                )}
            </b>
            <span>
              <span className="mono">{openOrder.action === 'hold' ? '' : signedAmount(openOrder.adjust, baseCurrency)}</span>
              {openOrder.currency !== baseCurrency && openOrder.action !== 'hold' && (
                <small className="hint mono">주문 {signedAmount(openOrder.adjustNative, openOrder.currency)}</small>
              )}
            </span>
          </div>
          <p className="order-sheet-say">
            {openOrder.action === 'hold'
              ? `${shortLabel(openRow)} 유지. 조정이 전체의 ${NOISE_THRESHOLD_PCT}% 미만입니다`
              : `${orderTitle(shortLabel(openRow), openOrder)}. 지금 가격으로 목표에 맞추는 참고입니다`}
          </p>
          <dl className="order-sheet-kv">
            <div>
              <dt>비중</dt>
              <dd className="mono">
                {num(weightNowOf(openRow), 1)}% → 목표 {num(openRow.current.target_weight_pct, 0)}%
                <small>
                  밴드 ±{num(openRow.current.band_pct, 1)}%p{' '}
                  {openRow.current.rebalance_signal.active ? '밖. 리뷰 때 맞출 종목' : '안'}
                </small>
              </dd>
            </div>
            <div>
              <dt>평가금액</dt>
              <dd className="mono">
                {amount(openRow.current.current_value_base, baseCurrency)}
                <small>목표 {amount(openOrder.targetValue, baseCurrency)}</small>
              </dd>
            </div>
            <div>
              <dt>신호</dt>
              <dd>
                <SignalBadges current={openRow.current} />
                {openRow.current.shoulder_signal_fired_in_period && (
                  <small>참고 = 이번 리뷰 기간에 매도 시그널이 뜬 적 있음, 주문 수량에는 영향이 없습니다</small>
                )}
              </dd>
            </div>
          </dl>
          {zeroNote(openOrder, openRow.current.target_weight_pct)}
          <div className="order-sheet-actions">
            <button
              type="button"
              onClick={() => {
                setOpenTicker(null)
                setTargetsOpen(true)
              }}
            >
              목표 수정
            </button>
            <Link className="link-button" to={`/stocks/${encodeURIComponent(openRow.ticker)}`}>
              종목 화면 열기
            </Link>
            <OrderTrade
              row={openRow}
              order={openOrder}
              fxNow={fxNowOf(openRow.current.currency)}
              onSaved={(done) => {
                orderSaved(openRow)(done)
                setOpenTicker(null)
              }}
              onError={setError}
            />
          </div>
          <p className="hint">수량, 평단가는 종목 화면의 &ldquo;보유&rdquo; 탭에서 고칩니다.</p>
        </Sheet>
      )}

      {targetsOpen && (
        <TargetSheet
          lines={targetLines}
          sum={`${num(draftSum, 1)}%`}
          sumOk={draftOk}
          cashNote={`현금 목표 ${num(plan.cash.targetPct, 0)}% 포함`}
          defaultBand={String(settings?.default_rebalance_band_pct ?? '')}
          dirtyCount={dirtyTickers.length}
          saving={saving}
          onChange={(ticker, patch) =>
            setDrafts((prev) => {
              const row = rowByTicker.get(ticker)
              const base = prev[ticker] ?? (row ? draftOf(row) : undefined)
              return base ? { ...prev, [ticker]: { ...base, ...patch } } : prev
            })
          }
          note={targetNote}
          noteSeq={targetSaves}
          onSave={() => void saveAll()}
          onReset={resetDrafts}
          center={!compact}
          onClose={() => {
            setTargetsOpen(false)
            setTargetNote(null)
          }}
        />
      )}

      {recordsOpen && (
        <Sheet
          title={`리뷰 기록${snapshots.length > 0 ? ` ${snapshots.length}건` : ''}`}
          label="리뷰 기록"
          closeLabel="리뷰 기록 닫기"
          className="records-sheet"
          center={!compact}
          sub={compact ? '남긴 날의 모습 그대로입니다. 종목을 지우거나 목표를 바꿔도 달라지지 않습니다.' : undefined}
          onClose={() => setRecordsOpen(false)}
        >
          <div className="sheet-body">
            <RecordPanel review={current.review} onSaved={handleSaved} onError={setError} />
            <SnapshotList snapshots={snapshots} onDeleted={handleSaved} onError={setError} />
            {!compact && <p className="hint">남긴 날의 모습 그대로입니다. 종목을 지우거나 목표를 바꿔도 달라지지 않습니다.</p>}
            <ValueRecordLine record={current.value_record} />
          </div>
        </Sheet>
      )}

      {settingsOpen && !compact && settings && (
        <Sheet
          title="리밸런싱 설정"
          label="리밸런싱 설정"
          closeLabel="설정 닫기"
          className="settings-sheet"
          center
          onClose={() => setSettingsOpen(false)}
        >
          <SettingsForm
            key={JSON.stringify([settings, cashCurrencies, fxCurrencies])}
            settings={settings}
            cash={cash}
            cashCurrencies={cashCurrencies}
            fxCurrencies={fxCurrencies}
            fx={fx}
            showFxEffect={showFxColumn}
            isAdmin={isAdmin}
            busy={settingsBusy || fxBusy}
            onRefreshFx={() => void refreshFx()}
            onSave={(payload) =>
              void (async () => {
                setFxBusy(true)
                try {
                  await api.updateSettings(payload)
                  setSettingsOpen(false)
                  handleSaved()
                } catch (e) {
                  setError(e)
                } finally {
                  setFxBusy(false)
                }
              })()
            }
            onCancel={() => setSettingsOpen(false)}
          />
        </Sheet>
      )}

      {settingsOpen && compact && (
        <Sheet
          title="리밸런싱 설정"
          label="리밸런싱 설정"
          closeLabel="설정 닫기"
          className="settings-sheet"
          onClose={() => setSettingsOpen(false)}
        >
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
              <span className="kpi-title">기준통화와 환율</span>
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
                          ? `1${meta.label} = ${num(quote.krw_rate, 2)}원, ${
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
                    ? '기준통화가 원일 때만 켤 수 있습니다. 달러·엔 기준이면 "매수 환율"의 뜻이 종목마다 달라집니다.'
                    : '켜면 매수 환율을 적은 외화 종목의 수익률·평가손익을 원화로 따집니다. 비중에는 영향이 없습니다.'}
                </p>
              </>
            )}
          </div>

          <div className="kpi">
            <div className="kpi-head">
              <span className="kpi-title">기본 밴드</span>
            </div>
            <div className="input-with-button">
              <NumberInput value={bandInput} onChange={setBandInput} aria-label="기본 밴드" />
              <span className="unit">%p</span>
              <button className="primary sm" onClick={saveBand} disabled={settingsBusy}>
                저장
              </button>
            </div>
            <p className="kpi-foot">
              종목마다 밴드를 비워 두면 이 값을 씁니다.
            </p>
          </div>

        </div>
        </Sheet>
      )}
    </div>
  )
}
