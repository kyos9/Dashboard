import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../../api/client'
import { useAuth } from '../AuthGate'
import { ConfirmDialog } from '../ConfirmDialog'
import { Icon } from '../icons/Icon'
import { StockEditModal } from '../StockEditModal'
import { SignalBadges } from '../ui/SignalBadges'
import { AddStockDialog } from './AddStockDialog'
import { SignalPanel } from './SignalPanel'
import { amount, avgPrice, num, price, qty, REVIEW_PERIOD_LABEL, rowLabel, savedStocksText, signed, signedAmount, stockLabel } from '../../lib/display'
import {
  joinItems,
  loadPnlCurrency,
  loadSort,
  pnlCurrencyOptions,
  pnlIn,
  savePnlCurrency,
  saveSort,
  signalsOf,
  sortItems,
  SORT_LABEL,
  tone,
  type PnlCurrency,
  type PortfolioItem,
  type SortKey,
} from '../../lib/portfolio'
import { cardConditions } from '../../lib/signalRules'
import { placeAt } from '../../lib/reorder'
import { readAiResult } from '../../lib/aiKey'
import { pushAccount } from '../../lib/push'
import { setHideAmounts, usePrefs } from '../../lib/prefs'
import type { DashboardCard, RebalanceCurrent, RebalanceRow, Stock } from '../../types'
import type { HoldingValues } from '../../lib/stockEdit'

type HomeTab = 'held' | 'watch' | 'signal'

interface Props {
  current: RebalanceCurrent
  cards: DashboardCard[]
  stocks: Stock[]
  canAdvise?: boolean
  /** 시그널 기준 창을 여나 — 옛 서버면 단추가 없다 */
  canEditThresholds: boolean
  onThresholds: () => void
  /** 종목 이름을 누르면 — 차트 팝업 */
  onChart: (card: DashboardCard) => void
  /** 무엇을 고쳤다 — 다시 받는다 */
  onSaved: () => void
  /** 순서 저장에 실패하면 화면에 알린다 */
  onError: (error: unknown) => void
}

function labelOf(item: PortfolioItem): string {
  return item.card ? stockLabel(item.card) : rowLabel(item.row)
}

/** "2026-12-30" → "12월 30일" */
function dayLabel(iso: string | null | undefined): string | null {
  if (!iso) return null
  const [, m, d] = iso.slice(0, 10).split('-').map(Number)
  return m && d ? `${m}월 ${d}일` : null
}

/** 사람이 적은 비중 그대로 — 6 은 6, 2.5 는 2.5 */
function pctText(value: number | null): string {
  return value == null ? '—' : String(Number(value.toFixed(2)))
}

/** 리뷰 날까지 — "D-40" · "오늘" · "3일 지남" */
function dDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const today = new Date()
  const a = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
  const b = Date.UTC(y, m - 1, d)
  const days = Math.round((b - a) / 86_400_000)
  if (days === 0) return '오늘'
  return days > 0 ? `D-${days}` : `${-days}일 지남`
}

/** 바깥을 누르거나 Esc 면 닫히는 작은 메뉴 */
function useOutside(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, close])
  return ref
}

function PopMenu({
  label,
  icon,
  text,
  items,
}: {
  label: string
  icon?: 'sortDown' | 'more'
  text?: string
  items: { key: string; label: string; on?: boolean; onClick: () => void }[]
}) {
  const [open, setOpen] = useState(false)
  const ref = useOutside(open, () => setOpen(false))
  return (
    <div className="pop-wrap" ref={ref}>
      <button
        type="button"
        className={icon ? 'home-tool icon-only' : 'home-tool'}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {icon ? <Icon name={icon} size={20} /> : text}
      </button>
      {open && (
        <div className="pop-menu" role="menu" aria-label={label}>
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role={item.on === undefined ? 'menuitem' : 'menuitemradio'}
              aria-checked={item.on}
              className={item.on ? 'on' : undefined}
              onClick={() => {
                setOpen(false)
                item.onClick()
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** 보유 표 "비중" 칸 — 디자인 5차 목업 12 나(주인 고름): 현재(파랑) · 목표(회색) 막대 둘, 종목 안 비중 카드를 작게. 허용 폭 밖이면 현재 숫자가 강조색 */
function WeightBars({ row, top }: { row: RebalanceRow; top: number }) {
  const width = (v: number) => `${Math.min(100, Math.max(0, (v / top) * 100))}%`
  const out = Math.abs(row.actual_weight_pct - row.target_weight_pct) > row.band_pct
  return (
    <div className="weight-bars" aria-label={`비중 ${num(row.actual_weight_pct, 1)}%, 목표 ${pctText(row.target_weight_pct)}%`} role="img">
      <span className="weight-bars-label">현재</span>
      <span className="weight-bars-track">
        <i className="now" style={{ width: width(row.actual_weight_pct) }} />
      </span>
      <b className={`mono${out ? ' out' : ''}`}>{num(row.actual_weight_pct, 1)}%</b>
      <span className="weight-bars-label">목표</span>
      <span className="weight-bars-track">
        <i className="target" style={{ width: width(row.target_weight_pct) }} />
      </span>
      <span className="mono">{pctText(row.target_weight_pct)}%</span>
    </div>
  )
}

/* ---------- 맨 위 총액 (목업 01 총액 A · 01c) ---------- */

function Summary({ current }: { current: RebalanceCurrent }) {
  const base = current.base_currency
  const pnl = current.unrealized_pnl_base
  const pnlPct = pnl !== null && current.cost_value_base ? (pnl / current.cost_value_base) * 100 : null
  const { hideAmounts } = usePrefs()
  const next = current.review
  return (
    <section className="home-sum" aria-label="내 자산">
      <div>
        <div className="home-sum-label">
          <span>총 평가금액</span>
          {/* 옆 사람이 볼 때 — 금액·수량을 가린다. %는 남는다. 이 기기에 기억한다 (ROADMAP 9-3) */}
          <button className="link-like" aria-pressed={hideAmounts} onClick={() => setHideAmounts(!hideAmounts)}>
            {hideAmounts ? '금액 보기' : '금액 가리기'}
          </button>
        </div>
        <div className="home-sum-big summary-num">{amount(current.total_value_base, base)}</div>
        <div className={`home-sum-pnl summary-num ${tone(pnl)}`}>
          {pnl === null ? (
            <span className="hint">평단가를 적으면 손익이 나옵니다</span>
          ) : (
            <>
              {signedAmount(pnl, base)} ({signed(pnlPct, 1, '%')})
            </>
          )}
        </div>
      </div>
      <div className={`home-sum-review${next.due ? ' due' : ''}`}>
        <span>다음 리뷰 ({next.period === 'annual' ? '1년에 한 번' : `${REVIEW_PERIOD_LABEL[next.period]}마다`})</span>
        <b className="summary-num">{next.due ? '리뷰할 때입니다' : `${dayLabel(next.next_date)} (${dDay(next.next_date)})`}</b>
      </div>
    </section>
  )
}

/* ---------- AI 띠 (목업 01g 나) ---------- */

function AiBand() {
  const { user } = useAuth()
  const last = readAiResult(pushAccount(user), '@portfolio')
  const when = last ? dayLabel(last.generated_at) : null
  return (
    <section className="ai-band" aria-label="AI 포트폴리오 점검">
      <span className="ai-band-ico" aria-hidden="true">
        <Icon name="ai" size={18} />
      </span>
      <div className="ai-band-text">
        <b>AI 포트폴리오 점검</b>
        <span>
          비중, 수익, 신호를 한 번에 보고 지금 할 일을 정리합니다.
          {when ? ` 마지막 점검은 ${when}입니다.` : ''}
        </span>
      </div>
      <Link to="/ai/portfolio" className="link-button ai-band-go">
        점검하기
      </Link>
    </section>
  )
}

/* ---------- 홈 ---------- */

/**
 * PC 홈 (디자인 5차 목업 01 · 02 — 주인이 고른 것). 총액 → AI 띠 → 보기 탭 셋(보유 종목 · 관심 종목 · 시그널).
 * 폰 홈은 5차 ④ 까지 예전 그대로(PortfolioView) — 이 부품은 PC 폭에서만 그린다.
 */
export function DesktopHome({ current, cards, stocks, canAdvise, canEditThresholds, onThresholds, onChart, onSaved, onError }: Props) {
  const base = current.base_currency
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const tab: HomeTab = params.get('view') === 'signal' ? 'signal' : params.get('view') === 'watch' ? 'watch' : 'held'
  const selected = params.get('ticker')
  const goTab = (next: HomeTab, ticker?: string) => {
    const p: Record<string, string> = {}
    if (next !== 'held') p.view = next
    if (ticker) p.ticker = ticker
    setParams(p, { replace: true })
  }
  usePrefs() // 금액 가리기를 바꾸면 표까지 다시 그린다

  const [sort, setSort] = useState<SortKey>(loadSort)
  const [pnlChoice, setPnlChoice] = useState<PnlCurrency>(loadPnlCurrency)
  const [note, setNote] = useState('')
  const [adding, setAdding] = useState(false)
  // 종목 수정 — 끌어서 순서 + 골라서 수정 (목업 01e: 순서 변경과 합침)
  const [editMode, setEditMode] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [editingPicked, setEditingPicked] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const [order, setOrder] = useState<string[] | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)

  const items = useMemo(() => joinItems(current.rows, cards), [current.rows, cards])
  const effectiveSort: SortKey = editMode ? 'mine' : sort
  const rank = useMemo(() => (order ? new Map(order.map((t, i) => [t, i])) : null), [order])
  const ranked = (list: PortfolioItem[]) => (rank ? [...list].sort((a, b) => (rank.get(a.row.ticker) ?? 0) - (rank.get(b.row.ticker) ?? 0)) : list)
  const held = useMemo(
    () => ranked(sortItems(items.filter((i) => i.row.quantity > 0), effectiveSort)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, effectiveSort, rank],
  )
  // 관심 종목은 내가 정한 순서 그대로(평가금액이 없다) — 등락순만 고를 수 있다
  const watching = useMemo(() => {
    const list = items.filter((i) => i.row.quantity <= 0)
    return ranked(sort === 'change' && !editMode ? sortItems(list, 'change') : list)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, sort, editMode, rank])
  const signalItems = useMemo(() => items.filter((i) => signalsOf(i).length > 0), [items])

  // ₩ / $ — 평가손익을 하나의 통화로 (주인 답: 종목별 보기 없이 기호 토글). 환율을 모르면 토글이 없고 종목별로 보인다
  const pnlOptions = pnlCurrencyOptions(current.fx, held.map((i) => i.row.shown_currency ?? i.row.currency))
  const canToggle = pnlOptions.includes('KRW') && pnlOptions.includes('USD')
  const pnlCurrency: PnlCurrency = !canToggle ? 'local' : pnlChoice === 'USD' ? 'USD' : 'KRW'
  const changePnl = (choice: PnlCurrency) => {
    setPnlChoice(choice)
    savePnlCurrency(choice)
  }
  const changeSort = (key: SortKey) => {
    setSort(key)
    saveSort(key)
  }

  const stockBy = useMemo(() => new Map(stocks.map((s) => [s.ticker, s])), [stocks])
  const holdings = useMemo(() => new Map<string, HoldingValues>(current.rows.map((row) => [row.ticker, row])), [current.rows])
  const owned = useMemo(() => new Set(stocks.map((s) => s.ticker)), [stocks])

  const startEdit = () => {
    setNote('')
    setPicked(new Set())
    setEditMode(true)
  }
  const endEdit = () => {
    setEditMode(false)
    setPicked(new Set())
    setOrder(null)
  }
  const togglePick = (ticker: string) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(ticker)) next.delete(ticker)
      else next.add(ticker)
      return next
    })
  const shown = tab === 'watch' ? watching : held
  const allPicked = shown.length > 0 && shown.every((i) => picked.has(i.row.ticker))
  const pickAll = () => setPicked(allPicked ? new Set() : new Set(shown.map((i) => i.row.ticker)))

  // 끌어서 순서 — 놓을 때 저장한다. 순서는 전 종목의 순서("내 순서")라 보유 · 관심이 같은 줄에 선다
  const fullOrder = () => order ?? current.rows.map((r) => r.ticker)
  const dragOver = (target: string, side: 'before' | 'after') => {
    if (!dragging || dragging === target) return
    const next = placeAt(fullOrder(), dragging, target, side)
    if (next.join() !== fullOrder().join()) setOrder(next)
  }
  const drop = async () => {
    setDragging(null)
    if (!order) return
    try {
      await api.updateStockOrder(order)
      onSaved()
    } catch (e) {
      setOrder(null)
      onError(e)
    }
  }

  const deletePicked = async () => {
    setBusy(true)
    try {
      const tickers = [...picked]
      await Promise.all(tickers.map((t) => api.purgeStock(t)))
      setNote(`${tickers.length}종목을 지웠습니다.`)
      setConfirmDelete(false)
      endEdit()
      onSaved()
    } catch (e) {
      onError(e)
    } finally {
      setBusy(false)
    }
  }

  const sortMenu = (keys: SortKey[]) => (
    <PopMenu
      label="정렬"
      icon="sortDown"
      items={keys.map((key) => ({ key, label: SORT_LABEL[key], on: sort === key, onClick: () => changeSort(key) }))}
    />
  )
  // 종목 추가 · 종목 수정은 글자 단추 둘 (주인: ⋯ 안에 있어 "종목 추가가 어딨는지 모르겠어" → 둘 다 꺼냄)
  const stockButtons = (
    <>
      <button type="button" className="home-tool" onClick={() => setAdding(true)} aria-haspopup="dialog">
        종목 추가
      </button>
      <button type="button" className="home-tool" onClick={startEdit}>
        종목 수정
      </button>
    </>
  )
  const pnlToggle = canToggle && (
    <div className="seg money-seg" role="group" aria-label="평가손익 통화">
      {(['KRW', 'USD'] as const).map((c) => (
        <button key={c} type="button" className={pnlCurrency === c ? 'active' : undefined} aria-pressed={pnlCurrency === c} onClick={() => changePnl(c)}>
          {c === 'KRW' ? '₩' : '$'}
        </button>
      ))}
    </div>
  )
  const pickBar = (
    <div className="home-tools pick-bar" role="group" aria-label="종목 수정">
      <span className="hint">끌어서 순서를 바꾸고, 골라서 고칩니다</span>
      <span className="pick-count">{picked.size}개 고름</span>
      <button type="button" className="link-like" onClick={pickAll}>
        {allPicked ? '모두 풀기' : '전체 고르기'}
      </button>
      <button type="button" className="sm danger-text" disabled={picked.size === 0} onClick={() => setConfirmDelete(true)}>
        삭제
      </button>
      <button type="button" className="sm" onClick={endEdit}>
        완료
      </button>
      <button type="button" className="sm primary" disabled={picked.size === 0} onClick={() => setEditingPicked(true)}>
        수정{picked.size > 0 ? ` (${picked.size})` : ''}
      </button>
    </div>
  )

  let tools: ReactNode = null
  if (editMode && tab !== 'signal') tools = pickBar
  else if (tab === 'held')
    tools = (
      <div className="home-tools">
        {held.length > 1 && sortMenu(['value', 'return', 'change', 'drift', 'mine'])}
        {pnlToggle}
        {stockButtons}
      </div>
    )
  else if (tab === 'watch')
    tools = (
      <div className="home-tools">
        {watching.length > 1 && sortMenu(['mine', 'change'])}
        {stockButtons}
      </div>
    )
  else if (canEditThresholds)
    tools = (
      <div className="home-tools">
        <button type="button" className="home-tool" onClick={onThresholds} aria-haspopup="dialog">
          기준
        </button>
      </div>
    )

  const rowProps = (item: PortfolioItem) => {
    const t = item.row.ticker
    if (!editMode) return { 'data-ticker': t }
    return {
      'data-ticker': t,
      className: `${picked.has(t) ? 'picked' : ''}${dragging === t ? ' dragging' : ''}`.trim() || undefined,
      onClick: (e: React.MouseEvent) => {
        if ((e.target as HTMLElement).closest('button, a, input')) return
        togglePick(t)
      },
      onDragOver: (e: React.DragEvent<HTMLTableRowElement>) => {
        e.preventDefault()
        const box = e.currentTarget.getBoundingClientRect()
        dragOver(t, e.clientY < box.top + box.height / 2 ? 'before' : 'after')
      },
      onDrop: (e: React.DragEvent) => {
        e.preventDefault()
        void drop()
      },
    }
  }
  const editCells = (item: PortfolioItem) => {
    if (!editMode) return null
    const t = item.row.ticker
    const label = labelOf(item)
    return (
      <td className="pick-cell">
        <span
          className="row-grip"
          draggable
          role="img"
          aria-label={`${label} 끌어서 순서 바꾸기`}
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = 'move'
            e.dataTransfer.setData('text/plain', t)
            setDragging(t)
          }}
          onDragEnd={() => {
            if (dragging) {
              setDragging(null)
            }
          }}
        >
          <Icon name="grip" size={18} />
        </span>
        <input type="checkbox" checked={picked.has(t)} onChange={() => togglePick(t)} aria-label={`${label} 고르기`} />
      </td>
    )
  }

  const nameCell = (item: PortfolioItem, sub?: ReactNode) => (
    <td className="name-cell">
      {item.card && !editMode ? (
        <button className="stock-name" onClick={() => onChart(item.card!)} title="차트 보기">
          {labelOf(item)}
        </button>
      ) : (
        <span className="stock-name plain">{labelOf(item)}</span>
      )}
      {sub && <span className="cell-sub">{sub}</span>}
    </td>
  )

  const badges = (item: PortfolioItem) => {
    const signals = signalsOf(item)
    if (signals.length === 0) return <span className="faint">—</span>
    return (
      <button
        type="button"
        className="badge-btn"
        onClick={() => goTab('signal', item.row.ticker)}
        aria-label={`${labelOf(item)} 신호: ${signals.map((s) => s.label).join(', ')}. 시그널 탭에서 보기`}
      >
        <SignalBadges signals={signals} />
      </button>
    )
  }

  // 비중 막대의 자 — 표 전체가 하나라 종목끼리 길이를 견줄 수 있다 (목업 12 나)
  const weightTop = Math.max(1, ...held.map((h) => Math.max(h.row.actual_weight_pct, h.row.target_weight_pct))) * 1.05
  const heldTable = (
    <table className="data-table home-table">
      <thead>
        <tr>
          {editMode && (
            <th className="pick-cell">
              <input type="checkbox" checked={allPicked} onChange={pickAll} aria-label="전체 고르기" />
            </th>
          )}
          <th className="name-cell">종목</th>
          <th>현재가</th>
          <th>수익률</th>
          <th>평가금액</th>
          <th>평가손익</th>
          <th>비중</th>
          <th>신호</th>
        </tr>
      </thead>
      <tbody>
        {held.map((item) => {
          const row = item.row
          const pnl = pnlIn(row, pnlCurrency, current.fx)
          const ret = row.shown_return_pct ?? row.return_pct
          return (
            <tr key={row.ticker} {...rowProps(item)}>
              {editCells(item)}
              {nameCell(item, `${qty(row.quantity)}주`)}
              <td>
                <b className="mono">{price(row.last_close, row.currency)}</b>
                <span className="cell-sub mono">{row.avg_cost === null ? '평단가 없음' : avgPrice(row.avg_cost, row.currency)}</span>
              </td>
              <td className={`mono ${tone(ret)}`}>{row.avg_cost === null ? '—' : signed(ret, 1, '%')}</td>
              <td title={row.currency === base ? undefined : `현지 ${amount(row.current_value, row.currency)}`}>
                <b className="mono">{amount(row.current_value_base, base)}</b>
              </td>
              <td className={`mono ${tone(pnl.value)}`}>{signedAmount(pnl.value, pnl.currency)}</td>
              <td>
                <WeightBars row={row} top={weightTop} />
              </td>
              <td>{badges(item)}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )

  const watchTable = (
    <table className="data-table home-table">
      <thead>
        <tr>
          {editMode && (
            <th className="pick-cell">
              <input type="checkbox" checked={allPicked} onChange={pickAll} aria-label="전체 고르기" />
            </th>
          )}
          <th className="name-cell">종목</th>
          <th>현재가</th>
          <th>전일 대비</th>
          <th>매수 조건</th>
          <th>신호</th>
          <th>마지막 매수 신호</th>
        </tr>
      </thead>
      <tbody>
        {watching.map((item) => {
          const row = item.row
          const conds = item.card ? Object.values(cardConditions(item.card)) : []
          const metCount = conds.filter((v) => v === true).length
          return (
            <tr key={row.ticker} {...rowProps(item)}>
              {editCells(item)}
              {nameCell(item)}
              <td>
                <b className="mono">{price(row.last_close, row.currency)}</b>
              </td>
              <td className={`mono ${tone(row.change_pct ?? null)}`}>{signed(row.change_pct ?? null, 2, '%')}</td>
              <td>
                {conds.length > 0 ? (
                  <span className="cond-dots" aria-label={`매수 조건 ${conds.length}개 중 ${metCount}개`}>
                    {conds.map((v, i) => (
                      <i key={i} className={v ? 'on' : undefined} />
                    ))}
                    <small className="mono">
                      {metCount} / {conds.length}
                    </small>
                  </span>
                ) : (
                  <span className="faint">—</span>
                )}
              </td>
              <td>{badges(item)}</td>
              <td className="mono dim">{dayLabel(item.card?.last_buy_signal_date) ?? '—'}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )

  const tabs: { key: HomeTab; label: string; count: number }[] = [
    { key: 'held', label: '보유 종목', count: held.length },
    { key: 'watch', label: '관심 종목', count: watching.length },
    { key: 'signal', label: '시그널', count: signalItems.length },
  ]

  return (
    <div className="desktop-home">
      <Summary current={current} />
      {canAdvise && <AiBand />}

      <div className="home-tabs-row">
        <div className="home-tabs" role="tablist" aria-label="홈 보기">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              className={`home-tab${tab === t.key ? ' active' : ''}`}
              onClick={() => {
                if (editMode && t.key === 'signal') endEdit()
                goTab(t.key)
              }}
            >
              {t.label}
              <span className={`home-tab-count${t.key === 'signal' && t.count > 0 ? ' sig' : ''}`}>{t.count}</span>
            </button>
          ))}
        </div>
        {tools}
      </div>

      {note && (
        <p className="hint saved-note" role="status">
          {note}
        </p>
      )}

      <div role="tabpanel" aria-label={tabs.find((t) => t.key === tab)?.label}>
        {tab === 'held' &&
          (held.length === 0 ? (
            <div className="empty-state compact">
              <p>아직 보유수량을 적은 종목이 없습니다. 종목 수정에서 수량과 평단가를 적으면 여기에 평가금액과 수익률이 나옵니다.</p>
            </div>
          ) : (
            heldTable
          ))}
        {tab === 'watch' &&
          (watching.length === 0 ? (
            <div className="empty-state compact">
              <p>관심 종목이 없습니다. 보유 수량이 0 인 종목이 여기에 모입니다.</p>
            </div>
          ) : (
            watchTable
          ))}
        {tab === 'signal' && (
          <SignalPanel
            items={signalItems}
            selected={selected}
            onSelect={(t) => goTab('signal', t)}
            onOpen={(item) => navigate(`/stocks/${encodeURIComponent(item.row.ticker)}`)}
          />
        )}
      </div>

      {adding && (
        <AddStockDialog
          owned={owned}
          onClose={() => setAdding(false)}
          onAdded={(message) => {
            setNote(message)
            onSaved()
          }}
          onError={onError}
        />
      )}

      {editingPicked && (
        <StockEditModal
          stocks={current.rows.map((r) => stockBy.get(r.ticker)).filter((s): s is Stock => !!s)}
          pick={[...picked]}
          holdings={holdings}
          cashTargetPct={current.cash.target_pct}
          onClose={() => setEditingPicked(false)}
          onSaved={(labels) => {
            setNote(savedStocksText(labels))
            onSaved()
          }}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title={`${picked.size}종목을 지울까요?`}
          confirmLabel="지우기"
          busy={busy}
          busyLabel="지우는 중…"
          onConfirm={() => void deletePicked()}
          onCancel={() => setConfirmDelete(false)}
        >
          <p>
            {[...picked]
              .map((t) => {
                const item = items.find((i) => i.row.ticker === t)
                return item ? labelOf(item) : t
              })
              .join(', ')}
          </p>
          <p className="hint">보유 기록과 시세가 같이 지워지고 되돌릴 수 없습니다.</p>
        </ConfirmDialog>
      )}
    </div>
  )
}
