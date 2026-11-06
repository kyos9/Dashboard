import { Link, useLocation } from 'react-router-dom'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useAppState } from '../AppState'
import { ApiError, api } from '../api/client'
import { useAuth } from '../components/AuthGate'
import { ErrorNotice } from '../components/ErrorNotice'
import { PageIntro } from '../components/PageIntro'
import { StockEditModal } from '../components/StockEditModal'
import { SymbolSearch } from '../components/SymbolSearch'
import { AddStockSheet } from '../components/stock/AddStockSheet'
import { emptyForm, type NewStockForm } from '../lib/stockForm'
import { Sparkline } from '../components/stock/Sparkline'
import { SignalBadges } from '../components/ui/SignalBadges'
import { Icon } from '../components/icons/Icon'
import { CURRENCY_BY_MARKET, CURRENCY_META, MARKET_LABEL, price, savedStocksText, signed, stockLabel } from '../lib/display'
import { fxFromInput } from '../lib/fxInput'
import type { DashboardCard, Holding, ListingStatus, Stock, SymbolMatch } from '../types'
import { listingHint, listingRefreshNotice } from '../lib/listing'
import { useRecheck } from '../lib/recheck'
import { useCachedLoad } from '../lib/cache'
import { cardSignals, tone } from '../lib/portfolio'
import { moveOne } from '../lib/reorder'
import { useNarrow } from '../lib/narrow'
import { useStockView } from '../lib/stockView'
import { useSparkHistory } from '../lib/sparkHistory'

/** 종목 탭 거르기 — 칩이 수를 겸한다 (목업 11) */
type Filter = 'all' | 'signal' | 'held' | 'watch' | 'inactive'
const FILTER_LABEL: Record<Filter, string> = { all: '전체', signal: '신호', held: '보유', watch: '관심', inactive: '비활성' }

/** 날짜("2026-09")가 줄 끝에서 "2026-" / "09"로 갈라지지 않게 묶는다 — 글은 lib/listing 그대로 (디자인 2차) */
function keepDates(text: string) {
  return text.split(/(\d{4}-\d{2}(?:-\d{2})?)/).map((part, i) =>
    i % 2 === 1 ? (
      <span key={i} className="nowrap">
        {part}
      </span>
    ) : (
      part
    ),
  )
}

/** 이름 아래 한 줄 — 이름 = 티커면(미국 종목) 티커를 다시 쓰지 않는다 "VOO / VOO · 미국" (디자인 2차) */
function subLine(stock: Stock) {
  return (
    <>
      {stockLabel(stock) !== stock.ticker && <>{stock.ticker} · </>}
      <span className="nowrap">
        {MARKET_LABEL[stock.market]} · {CURRENCY_META[stock.currency].symbol}
        {stock.currency}
      </span>
    </>
  )
}

/** 시세 상태 배지 — 줄·카드가 같이 쓴다 */
function StatusBadges({ stock }: { stock: Stock }) {
  return (
    <>
      {!stock.active && <span className="badge badge-grey">비활성</span>}
      {stock.data_status === 'loading' && <span className="badge badge-blue">시세 받는 중…</span>}
      {stock.data_status === 'failed' && (
        <span className="badge badge-amber" title={stock.data_hint ?? undefined}>
          시세 못 받음
        </span>
      )}
    </>
  )
}

function PriceBlock({ stock, card }: { stock: Stock; card: DashboardCard | undefined }) {
  const ind = card?.indicators
  if (!ind || ind.close === null) return <span className="stock-row-price hint">—</span>
  return (
    <span className="stock-row-price">
      <span className="mono">{price(ind.close, stock.currency)}</span>
      <span className={`mono stock-row-change ${tone(ind.change_pct)}`}>{signed(ind.change_pct ?? null, 2, '%')}</span>
    </span>
  )
}

/**
 * 종목 탭 (디자인 4차 목업 11 — 주인: 목록은 줄/카드를 사용자가 고름, 종목 안은 위 탭 넷).
 *
 * 맨 위 찾기 칸이 곧 추가다 — 고르면 아래에서 시트가 올라와 목표 비중·보유를 넣는다. 아래는 담은 종목의
 * 줄(또는 카드). 누르면 종목 안(/stocks/:ticker)으로 간다 — 차트 · 신호 · 재무 · 보유가 거기 있다.
 * 줄마다 있던 시세 갱신 · 비활성화 · 삭제는 종목 안 "보유"로, 한 번에 수정 · 순서는 ⋯ 로.
 */
export function StockManager() {
  const { refreshKey, notifyDataChanged } = useAppState()
  const { isAdmin } = useAuth()
  const narrow = useNarrow()
  const [view, setView] = useStockView()
  const [stocks, setStocks] = useState<Stock[]>([])
  const [cards, setCards] = useState<DashboardCard[]>([])
  const [form, setForm] = useState<NewStockForm>(emptyForm)
  const [cashTarget, setCashTarget] = useState(0)
  const [error, setError] = useState<unknown>(null)
  // 종목 안에서 지우고 돌아오면 한 줄 — 줄만 사라지던 것(사용자 확인 찾지 못한 것 4)
  const purged = (useLocation().state as { purged?: string } | null)?.purged
  const [notice, setNotice] = useState<{ tone: 'green' | 'amber'; text: string; detail?: string } | null>(() =>
    purged ? { tone: 'green', text: `${purged}을(를) 지웠습니다.` } : null,
  )
  // 목표 비중을 비운 채 수량을 넣고 추가했을 때 (0.45.4 C) — 위 알림은 시세를 다 받으면 바뀌어 사라지므로 따로,
  // 사람이 닫을 때까지 남긴다. 이어서 또 넣으면 마지막 것 하나만
  const [zeroTarget, setZeroTarget] = useState<string | null>(null)
  const [searchKey, setSearchKey] = useState(0)
  const [creating, setCreating] = useState(false)
  const [picked, setPicked] = useState<SymbolMatch | null>(null)
  // 고르지 않고 쳐서 넣는 종목 — 시트를 연 글자
  const [rawTicker, setRawTicker] = useState<string | null>(null)
  const [listingBusy, setListingBusy] = useState(false)
  const [listing, setListing] = useState<ListingStatus | null>(null)
  const [holdings, setHoldings] = useState<Map<string, Holding>>(new Map())
  const [filter, setFilter] = useState<Filter>('all')
  const [toolsOpen, setToolsOpen] = useState(false)
  const [ordering, setOrdering] = useState(false)
  const [orderBusy, setOrderBusy] = useState(false)
  // 종목 한 번에 수정 (ROADMAP 9-11)
  const [editing, setEditing] = useState(false)
  // 일괄 수정을 닫은 뒤 한 줄 — 수정을 다시 열 때까지 (0.45.2 A3)
  const [savedNote, setSavedNote] = useState('')
  // 순서 — 방금 옮긴 종목. 그 종목의 단추에 포커스를 두고 줄을 잠깐 표시한다(같은 자리를 다시 눌러 되돌아가던 것, 사용자 확인 막힌 곳 3)
  const [moved, setMoved] = useState<{ ticker: string; direction: 'up' | 'down' } | null>(null)

  const sheetOpen = picked !== null || rawTicker !== null
  // 산 환율은 목록에서 고른 외화 종목만 받는다
  const pickedCurrency = picked ? CURRENCY_BY_MARKET[picked.market] : null

  // 시세를 뒤에서 받는 중인 종목. 다음에 목록을 받았을 때 여기서 빠진 종목이 "다 받은" 종목이다.
  const loadingRef = useRef<string[]>([])

  const applyStocks = useCallback(
    (next: Stock[]) => {
      const before = loadingRef.current
      loadingRef.current = next.filter((s) => s.data_status === 'loading').map((s) => s.ticker)
      setStocks(next)

      const finished = next.filter((s) => before.includes(s.ticker) && s.data_status !== 'loading')
      if (finished.length === 0) return
      const failed = finished.filter((s) => s.data_status === 'failed')
      setNotice(
        failed.length > 0
          ? {
              tone: 'amber',
              text:
                `${failed.map(stockLabel).join(', ')} 시세를 받지 못했습니다. ` +
                (failed[0].data_hint ?? '종목 안 "보유"의 "시세 갱신"으로 다시 시도해주세요.'),
            }
          : {
              tone: 'green',
              text: `${finished.map(stockLabel).join(', ')} 시세를 다 받았습니다 — 지표와 시그널을 계산했습니다.`,
            },
      )
      notifyDataChanged()
    },
    [notifyDataChanged],
  )

  // 탭을 옮겨 와도 들고 있던 값을 먼저 그린다 (ROADMAP 8-1)
  const { loading: stocksLoading } = useCachedLoad('page:stocks', api.listStocks, applyStocks, setError, [refreshKey])
  // 줄의 현재가 · 등락 · 신호 — 홈과 같은 카드 응답. 못 읽으면 그 칸만 빈다
  useCachedLoad('page:stocks:cards', api.getDashboard, setCards, () => setCards([]), [refreshKey])

  // 받는 중인 종목이 있는 동안만 몇 초마다 다시 묻는다
  const recheck = useCallback(() => {
    api
      .listStocks()
      .then(applyStocks)
      .catch(() => {}) // 한 번 못 물어봐도 다음에 다시 묻는다
  }, [applyStocks])
  useRecheck(stocks.some((s) => s.data_status === 'loading'), recheck, stocks)

  // 지금 무엇으로 검색되는지는 "왜 이 종목이 안 나오지?"의 답이므로 화면에 띄워둔다.
  // 실패해도 검색 자체는 되므로 오류로 처리하지 않는다.
  useCachedLoad('page:stocks:listing', api.getListingStatus, setListing, () => setListing(null), [refreshKey])

  // 보유 — 못 읽으면 보유·관심 거르기만 빈다(종목 목록은 그대로 된다)
  useCachedLoad(
    'page:stocks:holdings',
    api.listHoldings,
    (list) => setHoldings(new Map(list.map((h) => [h.ticker, h]))),
    () => setHoldings(new Map()),
    [refreshKey],
  )

  // 목표 비중 합계에 현금 몫도 넣어야 100%가 맞는지 알 수 있다. 못 읽으면 0으로 본다.
  useCachedLoad('page:stocks:settings', api.getSettings, (s) => setCashTarget(s.cash_target_pct), () => setCashTarget(0), [refreshKey])

  const cardBy = useMemo(() => new Map(cards.map((c) => [c.ticker, c])), [cards])
  const held = (s: Stock) => (holdings.get(s.ticker)?.quantity ?? 0) > 0
  const matches = (s: Stock, f: Filter): boolean => {
    if (f === 'all') return true
    if (f === 'inactive') return !s.active
    if (!s.active) return false
    if (f === 'held') return held(s)
    if (f === 'watch') return !held(s)
    const card = cardBy.get(s.ticker)
    return !!card && cardSignals(card).length > 0
  }
  const counts = Object.fromEntries((Object.keys(FILTER_LABEL) as Filter[]).map((f) => [f, stocks.filter((s) => matches(s, f)).length])) as Record<Filter, number>
  // 비어 있는 거르기는 칩을 그리지 않는다 — "비활성 0"은 할 일이 아니다. 고른 칩은 0 이 되어도 남는다
  const filters = (Object.keys(FILTER_LABEL) as Filter[]).filter((f) => f === 'all' || counts[f] > 0 || f === filter)
  const visible = stocks.filter((s) => matches(s, filter))
  const spark = useSparkHistory(
    visible.filter((s) => s.active).map((s) => s.ticker),
    view === 'card' && !ordering,
  )

  const closeSheet = useCallback(() => {
    setPicked(null)
    setRawTicker(null)
  }, [])

  const createWith = async (query: string) => {
    if (!query) {
      setError('종목명이나 티커를 입력해주세요. (예: 삼성전자, VOO)')
      return
    }
    setCreating(true)
    setError(null)
    setNotice(null)
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
      setForm(emptyForm)
      closeSheet()
      setSearchKey((k) => k + 1) // 검색칸도 비운다 — 글자가 남은 채 다시 누르면 "입력해주세요"가 났다 (B 검토 참고)
      // 아주 빨리 받아서 목록에 "받는 중"이 한 번도 안 찍혀도 "다 받았다"를 알릴 수 있게
      if (result.data_pending) loadingRef.current = [...loadingRef.current, result.stock.ticker]

      // 이름으로 알린다 — 코드("035720.KS 추가 완료")만으로는 무엇을 넣었는지 알아보기 어렵다(제로베이스 점검 W7).
      // 어떤 티커로 해석됐는지도 그대로 보인다: "카카오 (035720.KS)"
      const name = stockLabel(result.stock)
      const label = name !== result.stock.ticker ? `${name} (${result.stock.ticker})` : name
      // 경고가 필요 없는 추가(목표를 넣었거나 수량이 없다)는 앞의 경고를 건드리지 않는다 — 앞 종목은 여전히 전부 파는 계산이다 (C 검토 2)
      if (quantity && form.targetWeight === '') {
        setZeroTarget(
          `${name}의 목표 비중을 비워 0%로 넣었습니다 — 리밸런싱에서 전부 파는 계산이 됩니다. 목표 비중은 종목 안의 '보유' 또는 ⋯ 의 '한 번에 수정'(리밸런싱에서는 '보유 · 목표 비중')에서 넣으세요.`,
        )
      }

      setNotice(
        result.data_pending
          ? {
              tone: 'green',
              text: `${label} 추가 완료 — 시세를 받는 중입니다. 다 받으면 지표와 시그널이 저절로 채워집니다.`,
            }
          : result.data_loaded
          ? {
              tone: 'green',
              text: `${label} 추가 완료 — 전체 시세를 내려받아 지표와 시그널을 계산했습니다.`,
            }
          : {
              tone: 'amber',
              text:
                `${label}은(는) 등록됐지만 시세를 받지 못했습니다. ` +
                (result.data_hint ?? '종목 안 "보유"의 "시세 갱신"으로 다시 시도해주세요.'),
              detail: result.data_error ?? undefined,
            },
      )
      notifyDataChanged()
    } catch (e) {
      // 시트는 닫는다 — 오류는 찾기 칸 위에 뜬다. 넣던 값은 남겨 두어 다시 열면 그대로다
      closeSheet()
      // 이미 담은 종목 — 서버는 영어 한 줄("VOO already exists")만 준다. 서버 말은 그대로 두고 화면에서 바꾼다 (0.45.4 B 사용자 확인).
      // 같은 409 라도 종목 수 한도는 서버가 한국어 안내를 같이 준다 — 그건 그대로 보인다 (B 검토 1)
      if (e instanceof ApiError && e.status === 409 && !e.hint && /already exists/.test(e.detail)) {
        setError(new ApiError(409, `${query}은(는) 이미 담은 종목입니다. 아래 목록에서 찾아 고치세요.`, e.detail))
      } else {
        setError(e)
      }
    } finally {
      setCreating(false)
    }
  }

  const refreshListing = async () => {
    setListingBusy(true)
    setNotice(null)
    try {
      const result = await api.refreshSymbolListing()
      api.getListingStatus().then(setListing).catch(() => {})
      setNotice(listingRefreshNotice(result))
    } catch (e) {
      setError(e)
    } finally {
      setListingBusy(false)
    }
  }

  /** 한 칸 옮기고 바로 저장한다. 실패하면 화면도 되돌린다 (홈 시그널 목록의 순서 편집과 같은 규칙) */
  const move = async (ticker: string, direction: 'up' | 'down') => {
    const order = stocks.map((s) => s.ticker)
    const next = moveOne(order, visible.map((s) => s.ticker), ticker, direction)
    if (next.join() === order.join()) return
    const previous = stocks
    const byTicker = new Map(stocks.map((s) => [s.ticker, s]))
    setStocks(next.map((t) => byTicker.get(t)!))
    setMoved({ ticker, direction })
    setOrderBusy(true)
    try {
      await api.updateStockOrder(next)
      setSavedNote('순서를 저장했습니다 — 홈 표와 시그널 목록도 이 순서입니다.')
      notifyDataChanged()
    } catch (e) {
      setStocks(previous)
      setError(e)
    } finally {
      setOrderBusy(false)
    }
  }

  const targetSum = stocks.filter((s) => s.active).reduce((sum, s) => sum + s.target_weight_pct, 0) + cashTarget
  const currencyMeta = pickedCurrency ? CURRENCY_META[pickedCurrency] : null
  const ownedTickers = useMemo(() => new Set(stocks.map((s) => s.ticker)), [stocks])
  const toolsShown = !narrow || toolsOpen || ordering

  return (
    <div className="stocks-page">
      <div className="page-head stocks-head">
        <div>
          <h2>
            종목 <span className="sub-count">{stocks.length}개</span>
          </h2>
          <PageIntro line="찾아서 담으면 지난 시세를 받아 지표·시그널을 계산합니다." firstVisit={stocksLoading ? null : stocks.length === 0}>
            국내주식은 종목명(삼성전자)이나 종목코드(005930)로, 미국주식은 티커(VOO)나 영문 이름(Agilent)으로 찾을 수
            있습니다. 구분(지수/알파/안전자산 등)은 자유 입력이며 시그널 목록의 거르기로 쓰입니다. 종목을 누르면 차트 · 신호 ·
            재무 · 보유가 있는 종목 안으로 갑니다. <span className="stock-listing-hint">{keepDates(listingHint(listing, isAdmin))}</span>
          </PageIntro>
        </div>
        {narrow && stocks.length > 0 && (
          <button
            type="button"
            className={`sub-more${toolsShown ? ' active' : ''}`}
            aria-label="보기·설정"
            aria-expanded={toolsShown}
            aria-controls="stock-view-tools"
            onClick={() => setToolsOpen((o) => !o)}
          >
            <Icon name="more" size={20} />
          </button>
        )}
      </div>

      <ErrorNotice error={error} onDismiss={() => setError(null)} />
      {zeroTarget && (
        <div className="callout amber" role="alert">
          <span className="ico">⚠</span>
          <div>{zeroTarget}</div>
          <button type="button" className="ghost sm" aria-label="목표 비중 알림 닫기" onClick={() => setZeroTarget(null)}>
            ✕
          </button>
        </div>
      )}
      {notice && (
        <div className={`callout ${notice.tone}`}>
          <span className="ico">{notice.tone === 'green' ? '✓' : '⚠'}</span>
          <div>
            {notice.text}
            {notice.detail && (
              <details className="error-detail">
                <summary>기술적 원인 보기</summary>
                <p>{notice.detail}</p>
              </details>
            )}
          </div>
        </div>
      )}

      {/* 찾기 = 추가 (목업 11). "관심 종목"은 홈에서 보유 0 인 종목이다 — 여기는 보유도 같이 넣는 곳이라 "종목 추가" (용어 사전) */}
      <section className="stock-find" aria-label="종목 추가">
        <SymbolSearch
          key={searchKey}
          selected={null}
          owned={ownedTickers}
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
        {/* 상장 목록은 전원이 같이 쓴다 — 받아오는 건 관리자만. 무엇으로 찾는지는 맨 위 "자세히" */}
        {isAdmin && (
          <button type="button" className="link-btn stock-find-raw" onClick={() => void refreshListing()} disabled={listingBusy}>
            {listingBusy ? '받는 중…' : '거래소 목록 갱신'}
          </button>
        )}
      </section>

      {stocks.length > 0 && (
        <>
          {toolsShown && (
            <div className="chip-row view-tools stock-tools" id="stock-view-tools" role="group" aria-label="보기·설정">
              <button type="button" className={`chip${view === 'list' && !ordering ? ' active' : ''}`} aria-pressed={view === 'list'} onClick={() => setView('list')}>
                줄 보기
              </button>
              <button type="button" className={`chip${view === 'card' && !ordering ? ' active' : ''}`} aria-pressed={view === 'card'} onClick={() => setView('card')}>
                카드 보기
              </button>
              <button
                type="button"
                className={`chip${ordering ? ' active' : ''}`}
                aria-pressed={ordering}
                onClick={() => {
                  setMoved(null)
                  setOrdering((o) => !o)
                }}
              >
                {ordering ? '순서 바꾸기 끝' : '↕ 순서 바꾸기'}
              </button>
              <button
                type="button"
                className="chip"
                onClick={() => {
                  setSavedNote('')
                  setEditing(true)
                }}
                aria-label="종목 한 번에 수정"
              >
                ✎ 한 번에 수정
              </button>
              <Link to="/fundamentals" className="chip">
                재무 한눈에
              </Link>
            </div>
          )}
          {savedNote && (
            <p className="hint saved-note" role="status">
              ✓ {savedNote}
            </p>
          )}

          <div className="chip-row stock-filters" role="group" aria-label="거르기">
            {filters.map((f) => (
              <button
                key={f}
                type="button"
                className={`chip${filter === f ? ' active' : ''}`}
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
              >
                {FILTER_LABEL[f]} <span className="mono">{counts[f]}</span>
              </button>
            ))}
            <span className={`badge stock-target-sum ${Math.abs(targetSum - 100) < 0.01 ? 'badge-green' : 'badge-amber'}`}>
              목표 비중 합계 {targetSum.toFixed(1)}%{cashTarget > 0 && ` (현금 ${cashTarget.toFixed(1)}% 포함)`}
            </span>
          </div>
        </>
      )}

      {stocks.length === 0 ? (
        <div className="empty-state">
          <h3>담은 종목이 없습니다</h3>
          <p>위 찾기 칸에 종목명(삼성전자)이나 티커(VOO)를 넣어 추가해주세요.</p>
        </div>
      ) : ordering ? (
        <ol className="stock-list stock-order" aria-label="종목 순서">
          {visible.map((s, i) => (
            <li key={s.ticker} className={`stock-row${moved?.ticker === s.ticker ? ' just-moved' : ''}`} data-ticker={s.ticker}>
              <span className="stock-row-name">
                <span className="stock-row-title">{stockLabel(s)}</span>
                <span className="stock-row-sub hint">{subLine(s)}</span>
              </span>
              <span className="move-buttons">
                <button
                  type="button"
                  aria-label={`${stockLabel(s)} 위로`}
                  disabled={orderBusy || i === 0}
                  ref={(el) => {
                    if (el && !orderBusy && moved?.ticker === s.ticker && moved.direction === 'up' && document.activeElement !== el) el.focus()
                  }}
                  onClick={() => void move(s.ticker, 'up')}
                >
                  ▲
                </button>
                <button
                  type="button"
                  aria-label={`${stockLabel(s)} 아래로`}
                  disabled={orderBusy || i === visible.length - 1}
                  ref={(el) => {
                    if (el && !orderBusy && moved?.ticker === s.ticker && moved.direction === 'down' && document.activeElement !== el) el.focus()
                  }}
                  onClick={() => void move(s.ticker, 'down')}
                >
                  ▼
                </button>
              </span>
            </li>
          ))}
        </ol>
      ) : view === 'card' ? (
        <ul className="stock-tiles" aria-label="담은 종목">
          {visible.map((s) => {
            const card = cardBy.get(s.ticker)
            return (
              <li key={s.ticker} data-ticker={s.ticker} className={s.active ? '' : 'inactive'}>
                <Link to={`/stocks/${encodeURIComponent(s.ticker)}`} className="stock-tile">
                  <span className="stock-row-title">{stockLabel(s)}</span>
                  <span className="stock-row-sub hint">{subLine(s)}</span>
                  <Sparkline values={spark.get(s.ticker) ?? []} />
                  {/* 선은 석 달, 아래 %는 하루 — 색이 달라도 헷갈리지 않게 이름을 붙인다(검토 참고 2 · 사용자 확인 8) */}
                  <span className="stock-tile-span hint">3개월</span>
                  <PriceBlock stock={s} card={card} />
                  <span className="stock-tile-badges">
                    {card && <SignalBadges signals={cardSignals(card)} />}
                    <StatusBadges stock={s} />
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      ) : (
        <ul className="stock-list" aria-label="담은 종목">
          {visible.map((s) => {
            const card = cardBy.get(s.ticker)
            return (
              <li key={s.ticker} data-ticker={s.ticker} className={s.active ? '' : 'inactive'}>
                <Link to={`/stocks/${encodeURIComponent(s.ticker)}`} className="stock-row">
                  <span className="stock-row-name">
                    <span className="stock-row-head">
                      <span className="stock-row-title">{stockLabel(s)}</span>
                      {card && <SignalBadges signals={cardSignals(card)} />}
                      <StatusBadges stock={s} />
                    </span>
                    <span className="stock-row-sub hint">{subLine(s)}</span>
                  </span>
                  <PriceBlock stock={s} card={card} />
                </Link>
              </li>
            )
          })}
        </ul>
      )}

      {sheetOpen && (
        <AddStockSheet
          title={picked ? picked.name : rawTicker ?? ''}
          sub={picked ? `${picked.ticker} · ${MARKET_LABEL[picked.market]} · ${currencyMeta?.label ?? ''}` : '목록에서 고르지 않은 이름 — 서버가 찾아 맞춥니다'}
          form={form}
          onChange={setForm}
          currency={pickedCurrency}
          currencySymbol={currencyMeta?.symbol ?? null}
          currencyLabel={currencyMeta?.label ?? null}
          busy={creating}
          onSubmit={() => void createWith(picked?.ticker ?? rawTicker ?? form.ticker.trim())}
          onClose={closeSheet}
        />
      )}

      {editing && (
        <StockEditModal
          stocks={stocks}
          holdings={holdings}
          cashTargetPct={cashTarget}
          onClose={() => setEditing(false)}
          onSaved={(labels) => {
            setSavedNote(savedStocksText(labels))
            setError(null)
            notifyDataChanged()
          }}
        />
      )}
    </div>
  )
}
