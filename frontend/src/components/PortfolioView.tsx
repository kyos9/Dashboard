import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  amount,
  avgPrice,
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
import {
  fxSplitText,
  joinItems,
  loadSort,
  saveSort,
  signalsOf,
  SORT_KEYS,
  SORT_LABEL,
  sortItems,
  tone,
  type PortfolioItem,
  type SignalKind,
  type SignalMark,
  type SortKey,
} from '../lib/portfolio'
import { setHideAmounts, usePrefs } from '../lib/prefs'
import type { Currency, DashboardCard, RebalanceCurrent } from '../types'
import { HoldingEditModal } from './HoldingEditModal'
import { MacroStrip } from './MacroStrip'
import { SignalShape, type ShapeKind } from './SignalShape'

interface Props {
  current: RebalanceCurrent
  cards: DashboardCard[]
  /** 폰 폭이면 한 종목을 두 줄로, 누르면 펼친다 */
  narrow: boolean
  onChart: (card: DashboardCard) => void
  /** 신호 점을 누르면 — 시그널 보기로 넘어가 그 종목을 보여준다 */
  onSignal: (ticker: string) => void
  onSaved: () => void
}

function labelOf(item: PortfolioItem): string {
  return item.card ? stockLabel(item.card) : rowLabel(item.row)
}

/**
 * 대시보드의 포트폴리오 보기 (ROADMAP 8-3) — 이 앱의 첫 화면.
 *
 * 맨 위는 내 돈 한 줄(총 평가금액·평가손익·최근 거래일 대비·현금), 아래는 보유 종목 표다.
 * 시그널은 부수라 줄 끝의 점 하나로만 있고, 누르면 시그널 보기로 간다. 보유 0 인 종목은
 * "관심 종목"으로 표 아래에 따로 모은다.
 *
 * 숫자는 전부 리밸런싱과 같은 응답에서 온다 — 두 화면의 합계가 원 단위까지 같다.
 */
export function PortfolioView({ current, cards, narrow, onChart, onSignal, onSaved }: Props) {
  const base = current.base_currency
  const [sort, setSort] = useState<SortKey>(loadSort)
  // 보유 수정 팝업 — 어느 종목을, 어느 칸부터 (ROADMAP 9-1)
  const [editing, setEditing] = useState<Editing | null>(null)
  usePrefs() // 금액 가리기를 바꾸면 아래 표까지 다시 그린다 (lib/display 의 amount 가 읽는다)

  const items = useMemo(() => joinItems(current.rows, cards), [current.rows, cards])
  const held = useMemo(
    () => sortItems(items.filter((i) => i.row.quantity > 0), sort),
    [items, sort],
  )
  // 관심 종목은 내가 정한 순서 그대로 — 평가금액이 없으니 금액순이 뜻이 없다
  const watching = useMemo(() => items.filter((i) => i.row.quantity <= 0), [items])
  const signalCount = items.filter((i) => signalsOf(i).length > 0).length

  const edit = (item: PortfolioItem, focus: EditFocus = 'quantity') => setEditing({ item, focus })

  const changeSort = (key: SortKey) => {
    setSort(key)
    saveSort(key)
  }

  return (
    <div className="portfolio">
      <MoneyLine current={current} signalCount={signalCount} />

      <div className="portfolio-sub">
        <MacroStrip />
        <ReviewLine current={current} />
      </div>

      <section className="section" aria-labelledby="holdings-title">
        <div className="section-head">
          <h3 id="holdings-title">보유 종목 {held.length > 0 && <span className="hint">{held.length}</span>}</h3>
          {held.length > 1 && (
            <label className="sort-pick">
              <span>정렬</span>
              <select value={sort} onChange={(e) => changeSort(e.target.value as SortKey)} aria-label="정렬">
                {SORT_KEYS.map((key) => (
                  <option key={key} value={key}>
                    {SORT_LABEL[key]}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {held.length === 0 ? (
          <div className="empty-state compact">
            <p>
              아직 보유수량을 적은 종목이 없습니다. 아래 관심 종목의 "수정"이나 <Link to="/rebalance">리밸런싱</Link>에서 수량과 평단가를
              적으면 여기에 평가금액·수익률이 나옵니다.
            </p>
          </div>
        ) : narrow ? (
          <HoldingList items={held} base={base} onChart={onChart} onSignal={onSignal} onEdit={edit} />
        ) : (
          <HoldingTable items={held} base={base} onChart={onChart} onSignal={onSignal} onEdit={edit} />
        )}
      </section>

      {watching.length > 0 && (
        <section className="section" aria-labelledby="watch-title">
          <div className="section-head">
            <h3 id="watch-title">
              관심 종목 <span className="hint">{watching.length}</span>
            </h3>
            <span className="hint">보유 0 — 시세와 신호만</span>
          </div>
          <WatchList items={watching} onChart={onChart} onSignal={onSignal} onEdit={edit} />
        </section>
      )}

      {signalCount > 0 && <SignalLegend />}

      {editing && (
        <HoldingEditModal
          target={{
            ticker: editing.item.row.ticker,
            label: labelOf(editing.item),
            currency: editing.item.row.currency,
            quantity: editing.item.row.quantity,
            avgCost: editing.item.row.avg_cost,
            avgFx: editing.item.row.avg_fx,
          }}
          focus={editing.focus}
          onClose={() => setEditing(null)}
          onSaved={onSaved}
        />
      )}
    </div>
  )
}

/* ---------- 맨 위 — 내 돈 한 줄 ---------- */

/** 대시보드와 리밸런싱이 같이 쓴다 — 두 화면의 요약 숫자가 같은 자리에서 나온다 */
export function MoneyLine({ current, signalCount }: { current: RebalanceCurrent; signalCount?: number }) {
  const base = current.base_currency
  const pnl = current.unrealized_pnl_base
  const pnlPct = pnl !== null && current.cost_value_base ? (pnl / current.cost_value_base) * 100 : null
  const day = current.day_change_base ?? null
  const unpriced = current.unpriced_count ?? 0
  const fxMissing = current.include_fx_effect ? (current.fx_missing_count ?? 0) : 0
  const { hideAmounts } = usePrefs()

  return (
    <section className="money-line" aria-label="내 자산">
      <div className="money-total">
        <span className="money-title-row">
          <span className="kpi-title">총 평가금액</span>
          {/* 옆 사람이 볼 때 — 금액·수량을 가린다. %는 남는다. 이 기기에 기억한다 (ROADMAP 9-3) */}
          <button
            className="link-like money-hide"
            aria-pressed={hideAmounts}
            onClick={() => setHideAmounts(!hideAmounts)}
          >
            {hideAmounts ? '금액 보기' : '금액 가리기'}
          </button>
        </span>
        <span className="money-big mono">{amount(current.total_value_base, base)}</span>
        <span className="hint">현금 포함 · {CURRENCY_META[base].label} 기준</span>
      </div>
      <dl className="money-facts">
        <div>
          <dt>평가손익</dt>
          <dd className={tone(pnl)}>
            {pnl === null ? (
              <span className="hint">평단가 입력 시</span>
            ) : (
              <>
                <span className="mono">{signedAmount(pnl, base)}</span>{' '}
                <span className="mono">{pnlPct === null ? '' : signed(pnlPct, 1, '%')}</span>
              </>
            )}
          </dd>
        </div>
        <div>
          <dt title="종목마다 자기 시장의 전일 종가 대비. 한국·미국은 마지막 거래일이 다릅니다. 지금 환율로 환산합니다.">
            최근 거래일 대비
          </dt>
          <dd className={tone(day)}>
            {day === null ? (
              '—'
            ) : (
              <>
                <span className="mono">{signedAmount(day, base)}</span>{' '}
                <span className="mono">{signed(current.day_change_pct ?? null, 2, '%')}</span>
              </>
            )}
          </dd>
        </div>
        <div>
          <dt>현금</dt>
          <dd className="mono">{amount(current.cash.value_base, base)}</dd>
        </div>
        {signalCount !== undefined && (
          <div>
            <dt>신호</dt>
            <dd className="mono">{signalCount}</dd>
          </div>
        )}
      </dl>
      {(unpriced > 0 || fxMissing > 0 || current.include_fx_effect) && (
        <p className="money-note hint">
          {[
            unpriced > 0 && `평단가 없는 ${unpriced}종목은 손익에서 뺐습니다`,
            current.include_fx_effect && '손익에 환율 효과 포함',
            fxMissing > 0 && `환율 미반영 ${fxMissing}종목`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      )}
    </section>
  )
}

function ReviewLine({ current }: { current: RebalanceCurrent }) {
  const review = current.review
  return (
    <p className={`review-line${review.due ? ' due' : ''}`}>
      <span>
        다음 리뷰 · {REVIEW_PERIOD_LABEL[review.period]}{' '}
        <b>{review.due ? '리뷰할 때' : reviewCountdown(review)}</b>{' '}
        <span className="mono hint">{review.next_date}</span>
      </span>
      <Link to="/rebalance">리밸런싱 →</Link>
    </p>
  )
}

/* ---------- 신호 점 ---------- */

function SignalDot({ label, signals, onSignal, ticker }: {
  label: string
  signals: SignalMark[]
  ticker: string
  onSignal: (ticker: string) => void
}) {
  // 신호가 없는 종목은 빈칸 — 누를 것이 없다
  if (signals.length === 0) return <span className="signal-slot" aria-hidden="true" />
  const text = signals.map((s) => s.label).join(' · ')
  // 모양은 종류마다 하나 — 과중·미달은 같은 ◆ 다 (한 종목에 둘이 같이 뜰 수는 없다)
  const shapes = [...new Set(signals.map((s) => SHAPE_OF[s.kind]))]
  return (
    <button
      className="signal-slot signal-dot-btn"
      onClick={() => onSignal(ticker)}
      title={`${text} — 눌러서 시그널 보기`}
      aria-label={`${label} 신호: ${text}. 시그널 보기로`}
    >
      {shapes.map((shape) => (
        <SignalShape key={shape} kind={shape} size={11} />
      ))}
    </button>
  )
}

const SHAPE_OF: Record<SignalKind, ShapeKind> = { buy: 'buy', sell: 'sell', over: 'rebalance', under: 'rebalance' }

/** 모양 풀이 — 신호가 있을 때만. 색을 못 가리는 사람도 모양으로 읽는다 (8-4) */
function SignalLegend() {
  return (
    <p className="signal-legend hint" aria-label="신호 모양 풀이">
      <span>
        <SignalShape kind="buy" size={9} /> 매수 시그널
      </span>
      <span>
        <SignalShape kind="sell" size={9} /> 매도 시그널
      </span>
      <span>
        <SignalShape kind="rebalance" size={9} /> 비중조절(과중·미달)
      </span>
      <span>— 누르면 시그널 보기</span>
    </p>
  )
}

/* ---------- 보유 수정 ---------- */

type EditFocus = 'quantity' | 'avgCost'
type OnEdit = (item: PortfolioItem, focus?: EditFocus) => void

interface Editing {
  item: PortfolioItem
  focus: EditFocus
}

/** 종목마다 "수정" — 수량·평단가·산 환율을 고치는 팝업을 연다 */
function EditButton({ item, onEdit }: { item: PortfolioItem; onEdit: OnEdit }) {
  return (
    <button className="link-like edit-holding" onClick={() => onEdit(item)} aria-label={`${labelOf(item)} 보유 수정`}>
      수정
    </button>
  )
}

/** 수익률 칸 — 평단가가 없으면 "평단가 입력", 환율 효과를 넣었으면 둘로 나눈 풀이 */
function ReturnCell({ item, onEnter }: { item: PortfolioItem; onEnter: () => void }) {
  const row = item.row
  if (row.avg_cost === null) {
    return (
      <button className="link-like" onClick={onEnter} aria-label={`${labelOf(item)} 평단가 입력`}>
        평단가 입력
      </button>
    )
  }
  const value = row.shown_return_pct ?? row.return_pct
  const split = row.fx_split
  return (
    <span className="return-cell">
      <span className={`mono ${tone(value)}`} title={split ? fxSplitText(split) : undefined}>
        {signed(value, 1, '%')}
      </span>
      {row.fx_missing && (
        <span className="fx-missing" title="산 환율이 없어 주가만으로 냈습니다. 종목의 수정 버튼에서 넣을 수 있습니다.">
          환율 미반영
        </span>
      )}
    </span>
  )
}

function pnlOf(item: PortfolioItem): { value: number | null; currency: Currency } {
  const row = item.row
  return {
    value: row.shown_pnl ?? row.unrealized_pnl,
    currency: row.shown_currency ?? row.currency,
  }
}

function PriceWithChange({ item }: { item: PortfolioItem }) {
  const row = item.row
  return (
    <span className="price-change">
      <span className="mono">{price(row.last_close, row.currency)}</span>{' '}
      <span className={`mono metric-note ${tone(row.change_pct)}`}>{signed(row.change_pct ?? null, 2, '%')}</span>
    </span>
  )
}

function NameButton({ item, onChart }: { item: PortfolioItem; onChart: (card: DashboardCard) => void }) {
  const label = labelOf(item)
  if (!item.card) return <span className="stock-name">{label}</span>
  return (
    <button className="stock-name" onClick={() => onChart(item.card!)} title="차트 보기">
      {label}
    </button>
  )
}

/* ---------- PC — 한 줄에 한 종목 ---------- */

interface ListProps {
  items: PortfolioItem[]
  base: Currency
  onChart: (card: DashboardCard) => void
  onSignal: (ticker: string) => void
  onEdit: OnEdit
}

function HoldingTable({ items, base, onChart, onSignal, onEdit }: ListProps) {
  return (
    <div className="table-scroll">
      <table className="data-table holdings-table">
        <thead>
          <tr>
            <th>종목</th>
            <th className="num-head">
              현재가
              <br />
              <span className="th-sub">(전일 대비)</span>
            </th>
            <th className="num-head">평단가</th>
            <th className="num-head">수익률</th>
            <th className="num-head">평가손익</th>
            <th className="num-head">
              평가금액
              <br />
              <span className="th-sub">({CURRENCY_META[base].symbol} 기준)</span>
            </th>
            <th className="num-head">
              비중
              <br />
              <span className="th-sub">(목표)</span>
            </th>
            <th className="signal-head">신호</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const row = item.row
            const pnl = pnlOf(item)
            return (
              <tr key={row.ticker} data-ticker={row.ticker}>
                <td>
                  <div className="stock-line">
                    <NameButton item={item} onChart={onChart} />
                    <span className="hint mono">{qty(row.quantity)}주</span>
                    <EditButton item={item} onEdit={onEdit} />
                  </div>
                </td>
                <td className="num-cell">
                  <PriceWithChange item={item} />
                </td>
                <td className="num-cell mono">{avgPrice(row.avg_cost, row.currency)}</td>
                <td className="num-cell">
                  <ReturnCell item={item} onEnter={() => onEdit(item, 'avgCost')} />
                </td>
                <td className={`num-cell mono ${tone(pnl.value)}`}>{signedAmount(pnl.value, pnl.currency)}</td>
                <td className="num-cell mono" title={row.currency === base ? undefined : `현지 ${amount(row.current_value, row.currency)}`}>
                  {amount(row.current_value_base, base)}
                </td>
                <td className="num-cell">
                  <span className="mono">{num(row.actual_weight_pct, 1)}%</span>{' '}
                  <span className="hint mono">({num(row.target_weight_pct, 0)}%)</span>
                </td>
                <td className="signal-cell">
                  <SignalDot label={labelOf(item)} signals={signalsOf(item)} ticker={row.ticker} onSignal={onSignal} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/* ---------- 폰 — 한 종목이 두 줄, 누르면 펼친다 ---------- */

function HoldingList({ items, base, onChart, onSignal, onEdit }: ListProps) {
  const [open, setOpen] = useState<Set<string>>(new Set())
  const toggle = (ticker: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(ticker)) next.delete(ticker)
      else next.add(ticker)
      return next
    })

  return (
    <ul className="holding-list">
      {items.map((item) => {
        const row = item.row
        const label = labelOf(item)
        const expanded = open.has(row.ticker)
        const pnl = pnlOf(item)
        const signals = signalsOf(item)
        const value = row.shown_return_pct ?? row.return_pct
        return (
          <li key={row.ticker} className={`holding-item${expanded ? ' open' : ''}`} data-ticker={row.ticker}>
            <div className="holding-main">
              <button
                className="holding-toggle"
                aria-expanded={expanded}
                aria-controls={`holding-${row.ticker}`}
                aria-label={`${label} 자세히`}
                onClick={() => toggle(row.ticker)}
              >
                <span className="holding-top">
                  <span className="holding-name">
                    {label} <span className="hint mono">{qty(row.quantity)}주</span>
                  </span>
                  <span className="holding-value mono">{amount(row.current_value_base, base)}</span>
                </span>
                <span className="holding-bottom">
                  <PriceWithChange item={item} />
                  <span className={`mono ${tone(value)}`}>
                    {row.avg_cost === null ? <span className="hint">평단가 —</span> : signed(value, 1, '%')}
                  </span>
                  <span className="mono">{num(row.actual_weight_pct, 1)}%</span>
                </span>
              </button>
              <SignalDot label={label} signals={signals} ticker={row.ticker} onSignal={onSignal} />
            </div>
            {expanded && (
              <div className="holding-detail" id={`holding-${row.ticker}`}>
                <dl>
                  <div>
                    <dt>평단가</dt>
                    <dd className="mono">
                      {row.avg_cost === null ? (
                        <button className="link-like" onClick={() => onEdit(item, 'avgCost')} aria-label={`${label} 평단가 입력`}>
                          평단가 입력
                        </button>
                      ) : (
                        avgPrice(row.avg_cost, row.currency)
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>평가손익</dt>
                    <dd className={`mono ${tone(pnl.value)}`}>
                      {signedAmount(pnl.value, pnl.currency)}
                      {row.fx_split && <span className="hint"> · {fxSplitText(row.fx_split)}</span>}
                      {row.fx_missing && <span className="fx-missing">환율 미반영</span>}
                    </dd>
                  </div>
                  <div>
                    <dt>목표 비중</dt>
                    <dd className="mono">
                      {num(row.target_weight_pct, 0)}% <span className="hint">({signed(row.excess_pct, 1, '%p')})</span>
                    </dd>
                  </div>
                  <div>
                    <dt>신호</dt>
                    <dd>
                      {signals.length === 0 ? (
                        <span className="hint">없음</span>
                      ) : (
                        <button className="link-like" onClick={() => onSignal(row.ticker)}>
                          {signals.map((s) => s.label).join(' · ')} →
                        </button>
                      )}
                    </dd>
                  </div>
                </dl>
                <div className="btn-group tight">
                  <button className="sm" onClick={() => onEdit(item)} aria-label={`${label} 보유 수정`}>
                    수정
                  </button>
                  {item.card && (
                    <button className="sm" onClick={() => onChart(item.card!)}>
                      차트
                    </button>
                  )}
                </div>
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/* ---------- 관심 종목 — 현재가·등락·신호만 ---------- */

function WatchList({ items, onChart, onSignal, onEdit }: {
  items: PortfolioItem[]
  onChart: (card: DashboardCard) => void
  onSignal: (ticker: string) => void
  onEdit: OnEdit
}) {
  return (
    <ul className="watch-list">
      {items.map((item) => (
        <li key={item.row.ticker} data-ticker={item.row.ticker}>
          <NameButton item={item} onChart={onChart} />
          <PriceWithChange item={item} />
          <EditButton item={item} onEdit={onEdit} />
          <SignalDot label={labelOf(item)} signals={signalsOf(item)} ticker={item.row.ticker} onSignal={onSignal} />
        </li>
      ))}
    </ul>
  )
}
