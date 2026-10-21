import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import { useBackToClose } from '../lib/backToClose'
import type { DashboardCard, FundamentalsResponse, HistoryResponse } from '../types'
import { useNarrow } from '../lib/narrow'
import { BuyConditions, SellConditions } from './BuyConditions'
import { useAuth } from './AuthGate'
import { ChartLegend, coverageText, PriceChart } from './PriceChart'
import { ErrorNotice } from './ErrorNotice'
import { FundamentalsPanel } from './FundamentalsPanel'
import { AiPanel } from './AiPanel'
import { pushAccount } from '../lib/push'
import { hasFundamentalsTab, type ChartTab } from '../lib/fundamentals'
import { lockBodyScroll } from '../lib/scrollLock'

export const RANGE_OPTIONS = [
  { value: '6mo', label: '6개월', days: 182 },
  { value: '1y', label: '1년', days: 365 },
  { value: '5y', label: '5년', days: 365 * 5 },
  { value: 'max', label: '전체', days: null },
] as const
export type Range = (typeof RANGE_OPTIONS)[number]['value']

/**
 * 고른 기간보다 저장된 시세가 짧은가.
 *
 * "5년을 눌렀는데 1년만 보인다"는 차트가 아니라 받아둔 데이터의 문제다. 평소 갱신은
 * 최근 2년만 받으므로, 등록할 때 전체를 못 받았으면 그 앞은 영영 비어 있게 된다.
 * 전체(max)는 얼마나 더 있는지 알 길이 없어 항상 다시 받아볼 수 있게 둔다.
 */
export function needsBackfill(history: HistoryResponse | null, range: Range): boolean {
  const first = history?.coverage?.first_date
  if (!first) return false
  const days = RANGE_OPTIONS.find((r) => r.value === range)?.days
  if (days == null) return true
  const cutoff = new Date(Date.now() - days * 86_400_000)
  // 주말·휴장일 때문에 며칠은 늘 비는다 — 한 주 넘게 모자랄 때만 말한다
  return new Date(`${first}T00:00:00Z`).getTime() - cutoff.getTime() > 7 * 86_400_000
}

/**
 * 저장된 구간을 알려주고, 모자라면 전체 기간을 다시 받게 한다.
 *
 * 문제를 느끼는 자리가 차트이므로 고치는 버튼도 여기 둔다. **다시 받기는 관리자만** —
 * 10년치를 통째로 받는 일이라 서버도 사용자에게는 막는다 (4-4b). 사용자에게는 짧다는
 * 사실만 알린다.
 */
export function ChartCoverage({
  ticker,
  history,
  range,
  onReloaded,
  onError,
}: {
  ticker: string
  history: HistoryResponse | null
  range: Range
  onReloaded: () => void
  onError: (e: unknown) => void
}) {
  const { isAdmin } = useAuth()
  const [busy, setBusy] = useState(false)

  const backfill = async () => {
    setBusy(true)
    try {
      await api.refreshStock(ticker, true)
      onReloaded()
    } catch (e) {
      onError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <p className="hint chart-coverage">
      {coverageText(history)}
      {needsBackfill(history, range) && !isAdmin && ' — 고른 기간보다 짧습니다 (앞부분은 관리자가 받을 수 있습니다).'}
      {needsBackfill(history, range) && isAdmin && (
        <>
          {' — 고른 기간보다 짧습니다. '}
          <button className="link-btn" onClick={() => void backfill()} disabled={busy}>
            {busy ? '받는 중…' : '전체 기간 다시 받기'}
          </button>
        </>
      )}
    </p>
  )
}

interface Props {
  ticker: string
  name?: string | null
  /** 대시보드에서 열면 그 종목의 카드 — 차트 위에 오늘 매수 조건 한 줄(디자인 2차, 주인 결정).
   * 재무·더보기 차트에서 열면 없다(그때는 그 줄이 없다) */
  card?: DashboardCard
  /** 어느 탭부터 — "재무" 화면에서 열면 재무, 대시보드의 "AI 분석" 버튼으로 열면 AI */
  initialTab?: ChartTab
  onClose: () => void
}

/**
 * 종목 차트를 화면 위에 띄운다.
 *
 * 차트를 보려고 페이지를 떠나면 보던 표의 스크롤 위치와 필터가 날아가고, 돌아오면
 * 다시 찾아야 한다. 차트는 "잠깐 확인하는" 것이므로 지금 화면 위에 얹는다.
 */
export function ChartModal({ ticker, name, card, initialTab = 'chart', onClose }: Props) {
  // 매도 조건 (참고) 줄이 더해지는 날, 폰(360×640)에서 차트의 날짜 축이 첫 화면 밖으로 나갔다 — 그만큼 줄인다 (0.45.0 C)
  const narrow = useNarrow()
  const chartHeight = narrow && card?.shoulder_sell_ref && card.sell_conditions ? 330 : 380
  const [tab, setTab] = useState<ChartTab>(initialTab)
  const [fundamentals, setFundamentals] = useState<FundamentalsResponse | null>(null)
  const [range, setRange] = useState<Range>('1y')
  const [history, setHistory] = useState<HistoryResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    setLoading(true)
    setError(null)
    api
      .getHistory(ticker, range)
      .then(setHistory)
      .catch(setError)
      .finally(() => setLoading(false))
  }, [ticker, range, reloadKey])

  // 재무는 한 번만 — 차트 기간을 바꿀 때마다 다시 물을 이유가 없다. 못 받아도 차트는 그대로다.
  useEffect(() => {
    let alive = true
    api
      .getFundamentals(ticker)
      .then((data) => alive && setFundamentals(data))
      .catch(() => alive && setFundamentals(null))
    return () => {
      alive = false
    }
  }, [ticker])

  const { user, guest, pending, canAdvise } = useAuth()
  const showFundamentals = hasFundamentalsTab(fundamentals)
  // AI 분석은 들어와 쓰는 사람만 — 손님·승인 대기는 담은 종목이 없다
  const showAi = !guest && !pending
  const activeTab: ChartTab =
    (tab === 'fundamentals' && !showFundamentals) ||
    (tab === 'ai' && !showAi)
      ? 'chart'
      : tab
  const tabs: { key: ChartTab; label: string }[] = [
    { key: 'chart', label: '차트' },
    ...(showFundamentals ? [{ key: 'fundamentals' as const, label: '재무' }] : []),
    ...(showAi ? [{ key: 'ai' as const, label: 'AI 분석' }] : []),
  ]

  // 폰의 뒤로가기로도 닫힌다
  useBackToClose(onClose)

  // ESC로 닫기 + 뒤 화면이 같이 스크롤되지 않게.
  // Tab 은 팝업 안에서만 돈다 — 밖으로 새면 키보드로 뒤 화면을 누르게 된다 (디자인 2차 검토, DESIGN_PROMPT 3-1)
  const dialogRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const focusables = () =>
      Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((el) => !el.closest('[hidden], [aria-hidden="true"]'))
    const onTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !dialogRef.current) return
      const items = focusables()
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement as HTMLElement | null
      const inside = !!active && dialogRef.current.contains(active)
      if (e.shiftKey && (!inside || active === first)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (!inside || active === last)) {
        e.preventDefault()
        first.focus()
      }
    }
    // 열면 포커스를 팝업으로, 닫으면 연 단추로 돌려준다 (디자인 2차 재검토)
    const opener = document.activeElement as HTMLElement | null
    dialogRef.current?.focus()
    document.addEventListener('keydown', onTab)
    return () => {
      document.removeEventListener('keydown', onTab)
      opener?.focus?.()
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    const release = lockBodyScroll()
    return () => {
      document.removeEventListener('keydown', onKey)
      release()
    }
  }, [onClose])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="modal chart-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`${name ?? ticker} 차트`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div className="modal-title">
            <h3>{name ?? ticker}</h3>
            {/* 이름이 티커와 같으면(미국 종목은 늘 그렇다) 두 번 쓰지 않는다 — "VOO VOO" (디자인 2차) */}
            {name && name !== ticker && <span className="hint">{ticker}</span>}
          </div>
          {tabs.length > 1 && (
            <div className="chip-row" role="tablist" aria-label="보기">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={activeTab === t.key}
                  className={`chip${activeTab === t.key ? ' active' : ''}`}
                  onClick={() => setTab(t.key)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}
          {activeTab === 'chart' && (
            <div className="chip-row">
              {RANGE_OPTIONS.map((r) => (
                <button
                  key={r.value}
                  className={`chip${range === r.value ? ' active' : ''}`}
                  onClick={() => setRange(r.value)}
                >
                  {r.label}
                </button>
              ))}
            </div>
          )}
          <button className="icon-btn" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </div>

        {activeTab === 'ai' ? (
          <AiPanel
            // AI 분석은 하나 (9-13) — 웹을 찾아보는 종목 분석(내 비중 % 포함, 9-8). 내 비중이 가므로
            // 관리자가 사용자에게 닫아 두면(9-15) 그 사용자는 공용 숫자만 보내는 종목 정리를 받는다.
            target={canAdvise ? { kind: 'research', ticker } : { kind: 'stock', ticker }}
            account={pushAccount(user)}
          />
        ) : activeTab === 'fundamentals' && fundamentals ? (
          <FundamentalsPanel data={fundamentals} />
        ) : (
          <>
            <ErrorNotice error={error} onDismiss={() => setError(null)} />
            {/* 신호의 근거를 팝업 안에서 — 닫고 카드로 돌아가 읽지 않게 (과업 3) */}
            {card && (
              <div className="signal-rows chart-conditions">
                <BuyConditions card={card} />
                <SellConditions card={card} />
              </div>
            )}
            <PriceChart history={history} height={chartHeight} />
            <ChartLegend history={history} loading={loading} />
            <ChartCoverage
              ticker={ticker}
              history={history}
              range={range}
              onReloaded={() => setReloadKey((k) => k + 1)}
              onError={setError}
            />
          </>
        )}
      </div>
    </div>
  )
}
