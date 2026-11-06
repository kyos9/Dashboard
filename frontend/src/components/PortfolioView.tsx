import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from './icons/Icon'
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
  savedStocksText,
  signed,
  signedAmount,
  stockLabel,
  trafficLight,
} from '../lib/display'
import {
  fxSplitText,
  joinItems,
  loadPnlCurrency,
  loadSort,
  pnlCurrencyOptions,
  pnlIn,
  savePnlCurrency,
  saveSort,
  signalsOf,
  SORT_KEYS,
  SORT_LABEL,
  sortItems,
  tone,
  type PnlCurrency,
  type PortfolioItem,
  type SignalKind,
  type SignalMark,
  type SortKey,
} from '../lib/portfolio'
import { setHideAmounts, usePrefs } from '../lib/prefs'
import { useSignalRules } from '../lib/signalRules'
import type { Currency, DashboardCard, FxInfo, RebalanceCurrent, Stock } from '../types'
import type { EditField, HoldingValues } from '../lib/stockEdit'
import { StockEditModal } from './StockEditModal'
import { SignalShape, type ShapeKind } from './SignalShape'
import { hasWeightSignal } from './weightSignal'

interface Props {
  current: RebalanceCurrent
  cards: DashboardCard[]
  /** 내 종목 설정(구분·목표·밴드) — "수정"이 이것과 보유를 한 번에 고친다 */
  stocks: Stock[]
  /** 폰 폭이면 한 종목을 두 줄로, 누르면 펼친다 */
  narrow: boolean
  onChart: (card: DashboardCard) => void
  /** 신호 점을 누르면 — 시그널 보기로 넘어가 그 종목을 보여준다 */
  onSignal: (ticker: string) => void
  /** 맨 위 "확인할 신호" — 종류를 누르면 그 종류만 걸러진 시그널 보기로, "시그널 보기"는 모두 (디자인 2차, 주인 결정 ②) */
  onOpenSignals: (kind?: SignalFilter) => void
  /** AI 포트폴리오 점검을 쓸 수 있나 — 관리자는 늘, 사용자는 관리자가 열어 둔 동안 (9-15) */
  canAdvise?: boolean
  onSaved: () => void
}

/** 시그널 보기의 신호 거르기 중 "확인할 신호"에서 고를 수 있는 것 */
export type SignalFilter = 'knee' | 'sell' | 'rebalance'

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
export function PortfolioView({ current, cards, stocks, narrow, onChart, onSignal, onOpenSignals, canAdvise, onSaved }: Props) {
  const base = current.base_currency
  const [sort, setSort] = useState<SortKey>(loadSort)
  // 종목 한 번에 수정 — 열려 있으면 처음 커서를 둘 자리 (ROADMAP 9-11)
  const [editing, setEditing] = useState<Editing | null>(null)
  // 일괄 수정을 닫은 뒤 한 줄 — 수정을 다시 열 때까지 (0.45.2 A3)
  const [savedNote, setSavedNote] = useState('')
  usePrefs() // 금액 가리기를 바꾸면 아래 표까지 다시 그린다 (lib/display 의 amount 가 읽는다)

  const items = useMemo(() => joinItems(current.rows, cards), [current.rows, cards])
  const held = useMemo(
    () => sortItems(items.filter((i) => i.row.quantity > 0), sort),
    [items, sort],
  )
  // 관심 종목은 내가 정한 순서 그대로 — 평가금액이 없으니 금액순이 뜻이 없다
  const watching = useMemo(() => items.filter((i) => i.row.quantity <= 0), [items])
  // 평가손익 칸의 통화 — 종목별 또는 하나로 (ROADMAP 9-12). 환율을 모르는 통화는 고를 수 없다
  const pnlOptions = pnlCurrencyOptions(
    current.fx,
    held.map((i) => i.row.shown_currency ?? i.row.currency),
  )
  const [pnlChoice, setPnlChoice] = useState<PnlCurrency>(loadPnlCurrency)
  const pnlCurrency: PnlCurrency = pnlOptions.includes(pnlChoice) ? pnlChoice : 'local'
  const signalCount = items.filter((i) => signalsOf(i).length > 0).length
  // 맨 위 "확인할 신호" — 종류마다 몇 종목인지. 누르면 시그널 보기가 그 종류로 걸러지므로 **시그널 보기의 신호 요약·거르기와
  // 같은 규칙**으로 센다(디자인 2차, 주인 결정 ②) — 매수 = 신호등 매수, 매도 = 신호등 매도, 비중조절 = 과중·미달(정기 리뷰 빼고, components/weightSignal).
  // 예전에는 줄 끝 점(▲▼◆)의 규칙이라, 매수와 매도가 같이 뜬 종목은 매도로도 셌다(신호등은 그 종목을 매수로 보인다)
  const rules = useSignalRules()
  const signalKinds = useMemo(() => {
    const cardsOnly = items.flatMap((i) => (i.card ? [i.card] : []))
    const lights = cardsOnly.map((c) => trafficLight(c, rules).state)
    return {
      buy: lights.filter((l) => l === 'buy').length,
      sell: lights.filter((l) => l === 'hot').length,
      rebalance: cardsOnly.filter(hasWeightSignal).length,
    }
  }, [items, rules])

  const startEdit = (next: Editing) => {
    setSavedNote('')
    setEditing(next)
  }
  const edit: OnEdit = (item, field = 'quantity') => startEdit({ ticker: item.row.ticker, field })
  // 리밸런싱 응답의 종목(활성)만 — 순서도 그대로
  const editable = useMemo(() => {
    const byTicker = new Map(stocks.map((stock) => [stock.ticker, stock]))
    return current.rows.map((row) => byTicker.get(row.ticker)).filter((stock): stock is Stock => !!stock)
  }, [stocks, current.rows])
  const holdings = useMemo(
    () => new Map<string, HoldingValues>(current.rows.map((row) => [row.ticker, row])),
    [current.rows],
  )

  const changePnl = (choice: PnlCurrency) => {
    setPnlChoice(choice)
    savePnlCurrency(choice)
  }

  const changeSort = (key: SortKey) => {
    setSort(key)
    saveSort(key)
  }

  return (
    <div className="portfolio">
      {/* 디자인 4차 B (목업 05b): 요약 칸(총액 크게 + 네 칸) → 신호 칸 셋 → 표. 매크로 줄은 대시보드에서 뺐다(주인 답 ㉡) */}
      <MoneyLine current={current} review />

      {/* PC 는 오른쪽 칸(목업 09b A), 폰은 요약 아래 — 신호 칸과 AI 진단 한 줄 (디자인 4차 묶음 2) */}
      <aside className="portfolio-rail" aria-label="신호와 AI">
        <SignalLine kinds={signalKinds} onOpen={onOpenSignals} />
        {!narrow && signalCount > 0 && (
          // PC 만 — 신호가 뜬 종목 몇 개를 미리. 폰은 칸 셋으로 충분하다(첫 화면이 길어진다)
          <div className="rail-signals">
            {/* 다섯까지만 — 몇 중 몇인지 제목에 적는다 (사용자 확인: 전부처럼 읽혔다) */}
            <h3 className="rail-title">
              신호가 뜬 종목 <span className="hint">{Math.min(5, signalCount)} / {signalCount}</span>
            </h3>
            <ul>
              {held
                .concat(watching)
                .filter((i) => signalsOf(i).length > 0)
                .slice(0, 5)
                .map((item) => (
                  <li key={item.row.ticker}>
                    {item.card ? (
                      <button type="button" className="rail-name stock-name" onClick={() => onChart(item.card!)}>
                        {labelOf(item)}
                      </button>
                    ) : (
                      <span className="rail-name">{labelOf(item)}</span>
                    )}
                    <SignalBadges label={labelOf(item)} signals={signalsOf(item)} ticker={item.row.ticker} onSignal={onSignal} />
                  </li>
                ))}
            </ul>
            <button type="button" className="rail-more" onClick={() => onOpenSignals()}>
              시그널 {signalCount}종목 모두 보기 <Icon name="forward" size={16} />
            </button>
          </div>
        )}
        {canAdvise && (
          <Link to="/ai/portfolio" className="ai-row">
            <Icon name="ai" size={22} className="ai-row-mark" />
            <span className="ai-row-text">
              AI 포트폴리오 점검
              <span className="hint">내 비중 · 수익률로 전체를 점검</span>
            </span>
            <Icon name="forward" size={18} className="ai-row-go" />
          </Link>
        )}
      </aside>

      <section className="section" aria-labelledby="holdings-title">
        <div className="section-head">
          <h3 id="holdings-title">보유 종목 {held.length > 0 && <span className="hint">{held.length}</span>}</h3>
          <div className="holdings-tools">
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
            {held.length > 0 && pnlOptions.length > 1 && (
              <label className="sort-pick">
                <span>손익 통화</span>
                <select
                  value={pnlCurrency}
                  onChange={(e) => changePnl(e.target.value as PnlCurrency)}
                  aria-label="평가손익 통화"
                >
                  {pnlOptions.map((option) => (
                    <option key={option} value={option}>
                      {option === 'local' ? '종목별' : `${CURRENCY_META[option].symbol} ${CURRENCY_META[option].label}`}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {editable.length > 0 && (
              <button className="sm" onClick={() => startEdit({ ticker: null, field: 'quantity' })} aria-label="종목 한 번에 수정">
                ✎ 수정
              </button>
            )}
          </div>
        </div>
        {savedNote && (
          <p className="hint saved-note" role="status">
            ✓ {savedNote}
          </p>
        )}

        {held.length === 0 ? (
          <div className="empty-state compact">
            <p>
              아직 보유수량을 적은 종목이 없습니다. 위의 "수정"이나 <Link to="/rebalance">리밸런싱</Link>에서 수량과 평단가를
              적으면 여기에 평가금액·수익률이 나옵니다.
            </p>
          </div>
        ) : narrow ? (
          <HoldingList items={held} base={base} pnl={pnlCurrency} fx={current.fx} onChart={onChart} onSignal={onSignal} onEdit={edit} />
        ) : (
          <HoldingTable items={held} base={base} pnl={pnlCurrency} fx={current.fx} onChart={onChart} onSignal={onSignal} onEdit={edit} />
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
          <WatchList items={watching} onChart={onChart} onSignal={onSignal} />
        </section>
      )}

      {signalCount > 0 && <SignalLegend />}

      {editing && (
        <StockEditModal
          stocks={editable}
          holdings={holdings}
          cashTargetPct={current.cash.target_pct}
          focus={editing.ticker ? { ticker: editing.ticker, field: editing.field } : undefined}
          onClose={() => setEditing(null)}
          onSaved={(labels) => {
            setSavedNote(savedStocksText(labels))
            onSaved()
          }}
        />
      )}
    </div>
  )
}

/* ---------- 맨 위 — 확인할 신호 (디자인 1차) ----------
   아침에 열면 "오늘 할 일이 있나"를 먼저 안다. 개수만 보이고, 누르면 시그널 보기로 간다.
   숫자는 참고다 — 사라는 말이 아니라 "볼 것이 있다"는 말이다. */

function SignalLine({
  kinds,
  onOpen,
}: {
  kinds: { buy: number; sell: number; rebalance: number }
  onOpen: (kind?: SignalFilter) => void
}) {
  const parts: { kind: ShapeKind; filter: SignalFilter; label: string; n: number; tone: string }[] = [
    { kind: 'buy', filter: 'knee', label: '매수', n: kinds.buy, tone: 'tone-buy' },
    { kind: 'sell', filter: 'sell', label: '매도', n: kinds.sell, tone: 'tone-sell' },
    { kind: 'rebalance', filter: 'rebalance', label: '비중조절', n: kinds.rebalance, tone: 'tone-rebalance' },
  ]
  if (parts.every((p) => p.n === 0)) {
    return (
      // 신호가 없어도 시그널 목록(지표 표 · AI 종목 정리 · 시그널 기준 · 종목 설정)으로 갈 길은 남긴다 (묶음 2 검토 조건 1)
      <p className="signal-line quiet">
        확인할 신호가 없습니다
        <button type="button" className="link-like signal-line-go" onClick={() => onOpen()}>
          시그널 목록 보기
        </button>
      </p>
    )
  }
  // 칸 셋은 늘 같은 자리 — 0 인 칸은 누를 것이 없어 글자로만 둔다 (디자인 4차 B, 목업 05b)
  // 칸 하나가 단추 하나 — 누르면 그 종류만 걸러진 시그널 보기 (디자인 2차 사용자 확인, 주인 결정 ②)
  return (
    <section className="signal-counts" aria-label="확인할 신호">
      {parts.map((p) =>
        p.n > 0 ? (
          <button
            key={p.kind}
            type="button"
            className={`signal-count ${p.tone}`}
            onClick={() => onOpen(p.filter)}
            aria-label={`${p.label} ${p.n}종목 — 시그널 보기에서 ${p.label}만`}
          >
            <b className="signal-count-n">{p.n}</b>
            <span className="signal-count-label">
              <SignalShape kind={p.kind} size={10} />
              {p.label}
            </span>
          </button>
        ) : (
          <span key={p.kind} className="signal-count zero">
            <b className="signal-count-n">0</b>
            <span className="signal-count-label">
              <SignalShape kind={p.kind} size={10} />
              {p.label}
            </span>
          </span>
        ),
      )}
    </section>
  )
}

/* ---------- 맨 위 — 내 돈 한 줄 ---------- */

/**
 * 대시보드와 리밸런싱이 같이 쓴다 — 두 화면의 요약 숫자가 같은 자리에서 나온다.
 * 디자인 4차 B(목업 01c 가 · 05b): 총 평가금액만 크게, 그 아래 네 칸(평가손익 · 수익률 · 최근 거래일 대비 · 다음 리뷰/현금).
 * 숫자는 Spoqa Han Sans Neo(요약 칸 숫자만 — 주인 답 ㉣).
 */
export function MoneyLine({ current, signalCount, review = false }: { current: RebalanceCurrent; signalCount?: number; review?: boolean }) {
  const base = current.base_currency
  const pnl = current.unrealized_pnl_base
  const pnlPct = pnl !== null && current.cost_value_base ? (pnl / current.cost_value_base) * 100 : null
  const day = current.day_change_base ?? null
  const unpriced = current.unpriced_count ?? 0
  const fxMissing = current.include_fx_effect ? (current.fx_missing_count ?? 0) : 0
  const { hideAmounts } = usePrefs()
  const next = current.review

  const notes = [
    review && `현금 ${amount(current.cash.value_base, base)}`,
    `현금 포함 · ${CURRENCY_META[base].label} 기준`,
    unpriced > 0 && `평단가 없는 ${unpriced}종목은 손익에서 뺐습니다`,
    current.include_fx_effect && '손익에 환율 효과 포함',
    fxMissing > 0 && `환율 미반영 ${fxMissing}종목`,
  ].filter(Boolean)

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
        <span className="money-big summary-num">{amount(current.total_value_base, base)}</span>
      </div>
      <dl className="money-facts">
        <div>
          <dt>평가손익</dt>
          <dd className={tone(pnl)}>
            {pnl === null ? <span className="hint">평단가 입력 시</span> : <span className="summary-num">{signedAmount(pnl, base)}</span>}
          </dd>
        </div>
        <div>
          <dt>수익률</dt>
          <dd className={tone(pnl)}>
            {pnlPct === null ? <span className="hint">—</span> : <span className="summary-num">{signed(pnlPct, 1, '%')}</span>}
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
                <span className="summary-num">{signedAmount(day, base)}</span>{' '}
                <span className="summary-num money-sub">{signed(current.day_change_pct ?? null, 2, '%')}</span>
              </>
            )}
          </dd>
        </div>
        {review ? (
          <div className={next.due ? 'review-due' : undefined}>
            <dt>
              다음 리뷰 · {REVIEW_PERIOD_LABEL[next.period]}
            </dt>
            <dd>
              <span className="summary-num">{next.due ? '리뷰할 때' : reviewCountdown(next)}</span>{' '}
              <Link to="/rebalance" className="money-link">
                리밸런싱
              </Link>
              <span className="money-date summary-num">{next.next_date}</span>
            </dd>
          </div>
        ) : (
          <div>
            <dt>현금</dt>
            <dd className="summary-num">{amount(current.cash.value_base, base)}</dd>
          </div>
        )}
        {signalCount !== undefined && (
          <div>
            <dt>신호</dt>
            <dd className="summary-num">{signalCount}</dd>
          </div>
        )}
      </dl>
      <p className="money-note hint">{notes.join(' · ')}</p>
    </section>
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

/** 폰 표의 신호 — 모양 + 짧은 글자 배지(디자인 4차 B). 누르면 시그널 보기로(SignalDot 과 같은 이름) */
const BADGE_TEXT: Record<SignalKind, string> = { buy: '매수', sell: '매도', over: '비중 초과', under: '비중 미달' }
const BADGE_TONE: Record<SignalKind, string> = { buy: 'tone-buy', sell: 'tone-sell', over: 'weight', under: 'weight' }

function SignalBadges({ label, signals, onSignal, ticker }: {
  label: string
  signals: SignalMark[]
  ticker: string
  onSignal: (ticker: string) => void
}) {
  if (signals.length === 0) return null
  const text = signals.map((s) => s.label).join(' · ')
  return (
    <button
      type="button"
      className="holding-signals"
      onClick={() => onSignal(ticker)}
      title={`${text} — 눌러서 시그널 보기`}
      aria-label={`${label} 신호: ${text}. 시그널 보기로`}
    >
      {signals.map((s) => (
        <span key={s.kind} className={`holding-badge ${BADGE_TONE[s.kind]}`}>
          <SignalShape kind={SHAPE_OF[s.kind]} size={9} />
          {BADGE_TEXT[s.kind]}
        </span>
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
        <SignalShape kind="rebalance" size={9} /> 비중조절(비중 초과·미달)
      </span>
      <span>— 누르면 시그널 보기</span>
    </p>
  )
}

/* ---------- 수정 ---------- */

type OnEdit = (item: PortfolioItem, field?: EditField) => void

interface Editing {
  /** 커서를 둘 종목. 위의 "수정"으로 열면 없다(첫 종목) */
  ticker: string | null
  field: EditField
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
        <span className="fx-missing" title="산 환율이 없어 주가만으로 냈습니다. 보유 종목 위의 수정에서 넣을 수 있습니다.">
          환율 미반영
        </span>
      )}
    </span>
  )
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
  /** 평가손익을 보일 통화 — 종목별 또는 하나로 */
  pnl: PnlCurrency
  fx: FxInfo
  onChart: (card: DashboardCard) => void
  onSignal: (ticker: string) => void
  onEdit: OnEdit
}

/** 비중 — 숫자와 막대, 막대 위의 선이 목표 (목업 09b). 막대는 가장 큰 비중 40% 를 끝으로 본다 */
function WeightMeter({ actual, target }: { actual: number | null; target: number | null }) {
  const scale = (v: number | null) => `${Math.min(100, Math.max(0, ((v ?? 0) / 40) * 100))}%`
  return (
    <span className="weight-meter">
      <span className="weight-meter-text">
        <span className="mono">{num(actual, 1)}%</span>
        <span className="hint mono">목표 {num(target, 0)}%</span>
      </span>
      <span className="weight-meter-bar" aria-hidden="true">
        <i style={{ width: scale(actual) }} />
        {target != null && <em style={{ left: scale(target) }} />}
      </span>
    </span>
  )
}

function HoldingTable({ items, base, pnl: pnlCurrency, fx, onChart, onSignal, onEdit }: ListProps) {
  return (
    <div className="table-scroll">
      <table className="data-table holdings-table">
        <thead>
          <tr>
            {/* 디자인 4차 묶음 2 (목업 09b A) — 수량 · 평단가는 종목 아래 작게, 비중은 목표선이 있는 막대, 신호는 글자 배지 */}
            <th>
              종목
              <br />
              <span className="th-sub">수량 · 평단가</span>
            </th>
            <th className="num-head">
              현재가
              <br />
              <span className="th-sub">(전일 대비)</span>
            </th>
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
            <th className="num-head">수익률</th>
            <th className="num-head">
              평가손익
              <br />
              <span className="th-sub">
                {pnlCurrency === 'local' ? '(종목 통화)' : `(${CURRENCY_META[pnlCurrency].symbol} 기준)`}
              </span>
            </th>
            <th className="signal-head">신호</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const row = item.row
            const pnl = pnlIn(row, pnlCurrency, fx)
            return (
              <tr key={row.ticker} data-ticker={row.ticker}>
                <td>
                  <div className="stock-line">
                    <NameButton item={item} onChart={onChart} />
                  </div>
                  <span className="holding-sub mono">
                    {qty(row.quantity)}주 · 평단 {avgPrice(row.avg_cost, row.currency)}
                  </span>
                </td>
                <td className="num-cell">
                  <PriceWithChange item={item} />
                </td>
                <td className="num-cell mono" title={row.currency === base ? undefined : `현지 ${amount(row.current_value, row.currency)}`}>
                  <strong>{amount(row.current_value_base, base)}</strong>
                </td>
                <td className="num-cell">
                  <WeightMeter actual={row.actual_weight_pct} target={row.target_weight_pct} />
                </td>
                <td className="num-cell">
                  <ReturnCell item={item} onEnter={() => onEdit(item, 'avgCost')} />
                </td>
                <td className={`num-cell mono ${tone(pnl.value)}`}>{signedAmount(pnl.value, pnl.currency)}</td>
                <td className="signal-cell">
                  <SignalBadges label={labelOf(item)} signals={signalsOf(item)} ticker={row.ticker} onSignal={onSignal} />
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

function HoldingList({ items, base, pnl: pnlCurrency, fx, onChart, onSignal, onEdit }: ListProps) {
  const [open, setOpen] = useState<Set<string>>(new Set())
  const toggle = (ticker: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(ticker)) next.delete(ticker)
      else next.add(ticker)
      return next
    })

  return (
    <>
    <div className="holding-head" aria-hidden="true">
      <span>종목 · 수량 · 신호</span>
      <span>평가금액 · 비중</span>
      <span>수익률</span>
    </div>
    <ul className="holding-list">
      {items.map((item) => {
        const row = item.row
        const label = labelOf(item)
        const expanded = open.has(row.ticker)
        const pnl = pnlIn(row, pnlCurrency, fx)
        const signals = signalsOf(item)
        const value = row.shown_return_pct ?? row.return_pct
        return (
          <li key={row.ticker} className={`holding-item${expanded ? ' open' : ''}`} data-ticker={row.ticker}>
            {/* 디자인 4차 B (목업 05b) — 한 줄이 표의 한 줄: 종목 · 수량 | 평가금액 · 비중 % | 수익률 · 수익금. 신호는 이름 아래.
                비중 % 는 금액 아래(폰 360 에서 이름 칸 아래에 두면 두 줄로 접혔다) */}
            <div className="holding-main">
              <button
                className="holding-toggle"
                aria-expanded={expanded}
                aria-controls={`holding-${row.ticker}`}
                aria-label={`${label} 자세히`}
                onClick={() => toggle(row.ticker)}
              >
                <span className="holding-name-col">
                  <span className="holding-name">{label}</span>
                  <span className="holding-sub holding-qty">{qty(row.quantity)}주</span>
                </span>
                <span className="holding-value">
                  <span className="holding-amount">{amount(row.current_value_base, base)}</span>
                  <span className="holding-weight">비중 {num(row.actual_weight_pct, 1)}%</span>
                </span>
                <span className={`holding-return ${tone(value)}`}>
                  {row.avg_cost === null ? <span className="hint">평단가 —</span> : <span className="holding-pct">{signed(value, 1, '%')}</span>}
                  {row.avg_cost !== null && <span className={`holding-pnl ${tone(pnl.value)}`}>{signedAmount(pnl.value, pnl.currency)}</span>}
                </span>
              </button>
              <SignalBadges label={label} signals={signals} ticker={row.ticker} onSignal={onSignal} />
            </div>
            {expanded && (
              <div className="holding-detail" id={`holding-${row.ticker}`}>
                <dl>
                  <div>
                    <dt>현재가</dt>
                    <dd>
                      <PriceWithChange item={item} />
                    </dd>
                  </div>
                  <div>
                    <dt>보유 수량</dt>
                    <dd className="mono">{qty(row.quantity)}주</dd>
                  </div>
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
                {item.card && (
                  <div className="btn-group tight">
                    <button className="sm" onClick={() => onChart(item.card!)}>
                      차트
                    </button>
                  </div>
                )}
              </div>
            )}
          </li>
        )
      })}
    </ul>
    </>
  )
}

/* ---------- 관심 종목 — 현재가·등락·신호만 ---------- */

function WatchList({ items, onChart, onSignal }: {
  items: PortfolioItem[]
  onChart: (card: DashboardCard) => void
  onSignal: (ticker: string) => void
}) {
  return (
    <ul className="watch-list">
      {items.map((item) => (
        <li key={item.row.ticker} data-ticker={item.row.ticker}>
          <NameButton item={item} onChart={onChart} />
          <PriceWithChange item={item} />
          <SignalDot label={labelOf(item)} signals={signalsOf(item)} ticker={item.row.ticker} onSignal={onSignal} />
        </li>
      ))}
    </ul>
  )
}
