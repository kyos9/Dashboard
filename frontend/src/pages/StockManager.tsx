import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppState } from '../AppState'
import { api } from '../api/client'
import { useAuth } from '../components/AuthGate'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { ErrorNotice } from '../components/ErrorNotice'
import { NumberInput } from '../components/NumberInput'
import { SymbolSearch } from '../components/SymbolSearch'
import { CURRENCY_BY_MARKET, CURRENCY_META, MARKET_LABEL, stockLabel } from '../lib/display'
import type { ListingStatus, Stock, SymbolMatch } from '../types'
import { useRecheck } from '../lib/recheck'

/** 새 종목 입력칸. 숫자도 글자로 들고 있다 — 비워둔 것과 0을 구분해야 한다 */
interface NewStockForm {
  ticker: string
  category: string
  targetWeight: string
  quantity: string
  avgCost: string
}

const emptyForm: NewStockForm = { ticker: '', category: '', targetWeight: '', quantity: '', avgCost: '' }

/** 구분 입력을 돕는 예시값 — 자유 입력이므로 강제되지 않는다 */
const CATEGORY_SUGGESTIONS = ['지수', '알파', '안전자산']

function StockRow({
  stock,
  onSaved,
  onError,
  onPurge,
}: {
  stock: Stock
  onSaved: () => void
  onError: (e: unknown) => void
  onPurge: (stock: Stock) => void
}) {
  const [name, setName] = useState(stock.name ?? '')
  const [category, setCategory] = useState(stock.category ?? '')
  const [targetWeight, setTargetWeight] = useState(String(stock.target_weight_pct))
  const [bandPct, setBandPct] = useState(stock.rebalance_band_pct === null ? '' : String(stock.rebalance_band_pct))
  const [saving, setSaving] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const save = async () => {
    setSaving(true)
    try {
      await api.updateStock(stock.ticker, {
        name: name.trim() === '' ? null : name.trim(),
        category: category.trim() === '' ? null : category.trim(),
        target_weight_pct: Number(targetWeight),
        rebalance_band_pct: bandPct === '' ? null : Number(bandPct),
      })
      onSaved()
    } catch (e) {
      onError(e)
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async () => {
    try {
      if (stock.active) await api.deactivateStock(stock.ticker)
      else await api.updateStock(stock.ticker, { active: true })
      onSaved()
    } catch (e) {
      onError(e)
    }
  }

  const refresh = async () => {
    setRefreshing(true)
    onError(null)
    try {
      await api.refreshStock(stock.ticker)
      onSaved()
    } catch (e) {
      onError(e)
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <tr className={stock.active ? '' : 'inactive'}>
      <td>
        <div className="ticker-cell">
          {stock.market === 'US' ? (
            // 미국 종목은 티커가 곧 이름이라 고칠 것이 없다
            <span className="ticker-name">{stockLabel(stock)}</span>
          ) : (
            <input
              type="text"
              className="name-input"
              value={name}
              placeholder={stock.ticker}
              onChange={(e) => setName(e.target.value)}
              aria-label={`${stock.ticker} 표시 이름`}
            />
          )}
          <span className="ticker-sub">
            {stock.ticker} · {MARKET_LABEL[stock.market]} · {CURRENCY_META[stock.currency].symbol}
            {stock.currency}
          </span>
          {!stock.active && <span className="badge badge-grey">비활성</span>}
          {stock.data_status === 'loading' && <span className="badge badge-blue">시세 받는 중…</span>}
          {stock.data_status === 'failed' && (
            <span className="badge badge-amber" title={stock.data_hint ?? undefined}>
              시세 못 받음
            </span>
          )}
        </div>
      </td>
      <td>
        <input
          type="text"
          list="category-options"
          value={category}
          placeholder="예: 지수"
          onChange={(e) => setCategory(e.target.value)}
        />
      </td>
      <td>
        <div className="input-with-button tight">
          <NumberInput
            value={targetWeight}
            onChange={setTargetWeight}
            aria-label={`${stock.ticker} 목표 비중`}
          />
          <span className="unit">%</span>
        </div>
      </td>
      <td>
        <div className="input-with-button tight">
          <NumberInput
            placeholder="기본값"
            value={bandPct}
            onChange={setBandPct}
            aria-label={`${stock.ticker} 밴드 임계값`}
          />
          <span className="unit">%p</span>
        </div>
      </td>
      <td>
        <div className="btn-group tight">
          <button className="primary sm" onClick={save} disabled={saving}>
            {saving ? '저장 중…' : '저장'}
          </button>
          <button className="sm" onClick={refresh} disabled={refreshing}>
            {refreshing ? '갱신 중…' : '시세 갱신'}
          </button>
          <button className="sm ghost" onClick={toggleActive}>
            {stock.active ? '비활성화' : '활성화'}
          </button>
          <button className="sm danger" onClick={() => onPurge(stock)}>
            삭제
          </button>
        </div>
      </td>
    </tr>
  )
}

/** 지금 무엇으로 검색되고 있는지 한 줄로. 목록이 언제 기준인지 모르면
 *  "검색이 안 된다"의 원인을 사용자가 짐작할 수 없다. */
function listingHint(listing: ListingStatus | null): string {
  if (!listing) {
    return '신규 상장이나 사명이 바뀐 종목이 검색되지 않을 때 누르세요.'
  }
  if (listing.cached_count > 0) {
    const when = listing.updated_at ? listing.updated_at.slice(0, 10) : '최근'
    return `거래소 목록 ${listing.cached_count.toLocaleString('ko-KR')}종목으로 검색합니다 (${when} 받음). 새로 상장된 종목이 안 나오면 누르세요.`
  }
  return `아직 거래소 목록을 받지 못해 내장 목록 ${listing.seed_count.toLocaleString('ko-KR')}종목(${listing.seed_as_of} 기준)으로만 검색합니다. 중소형주를 찾으려면 눌러주세요.`
}

export function StockManager() {
  const { refreshKey, notifyDataChanged } = useAppState()
  const { isAdmin } = useAuth()
  const [stocks, setStocks] = useState<Stock[]>([])
  const [form, setForm] = useState<NewStockForm>(emptyForm)
  const [cashTarget, setCashTarget] = useState(0)
  const [error, setError] = useState<unknown>(null)
  const [notice, setNotice] = useState<{ tone: 'green' | 'amber'; text: string; detail?: string } | null>(null)
  const [creating, setCreating] = useState(false)
  const [picked, setPicked] = useState<SymbolMatch | null>(null)
  const [listingBusy, setListingBusy] = useState(false)
  const [listing, setListing] = useState<ListingStatus | null>(null)
  const [purging, setPurging] = useState<Stock | null>(null)
  const [purgeBusy, setPurgeBusy] = useState(false)

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
                (failed[0].data_hint ?? '아래 "시세 갱신"으로 다시 시도해주세요.'),
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

  useEffect(() => {
    api
      .listStocks()
      .then(applyStocks)
      .catch(setError)
  }, [refreshKey, applyStocks])

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
  useEffect(() => {
    api.getListingStatus().then(setListing).catch(() => setListing(null))
  }, [refreshKey])

  // 목표 비중 합계에 현금 몫도 넣어야 100%가 맞는지 알 수 있다. 못 읽으면 0으로 본다.
  useEffect(() => {
    api
      .getSettings()
      .then((s) => setCashTarget(s.cash_target_pct))
      .catch(() => setCashTarget(0))
  }, [refreshKey])

  const handleSaved = () => {
    setError(null)
    notifyDataChanged()
  }

  /** 종목과 딸린 기록을 전부 지운다. 되돌릴 수 없으므로 한 번 더 묻고 나서 온다. */
  const purge = async (stock: Stock) => {
    setPurgeBusy(true)
    setError(null)
    try {
      await api.purgeStock(stock.ticker)
      setPurging(null)
      setNotice({ tone: 'green', text: `${stockLabel(stock)}을(를) 지웠습니다.` })
      notifyDataChanged()
    } catch (e) {
      setError(e)
      setPurging(null)
    } finally {
      setPurgeBusy(false)
    }
  }

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
      const result = await api.createStock({
        ticker: query,
        category: form.category.trim() === '' ? null : form.category.trim(),
        target_weight_pct: form.targetWeight === '' ? 0 : Number(form.targetWeight),
        ...(quantity ? { quantity } : {}),
        ...(form.avgCost === '' ? {} : { avg_cost: Number(form.avgCost) }),
      })
      setForm(emptyForm)
      setPicked(null)
      // 아주 빨리 받아서 목록에 "받는 중"이 한 번도 안 찍혀도 "다 받았다"를 알릴 수 있게
      if (result.data_pending) loadingRef.current = [...loadingRef.current, result.stock.ticker]

      // 이름으로 등록했으면 어떤 티커로 해석됐는지 보여준다
      const label = result.resolved_from
        ? `${result.resolved_from} → ${result.stock.ticker}`
        : result.stock.ticker

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
                (result.data_hint ?? '아래 "시세 갱신"으로 다시 시도해주세요.'),
              detail: result.data_error ?? undefined,
            },
      )
      notifyDataChanged()
    } catch (e) {
      setError(e)
    } finally {
      setCreating(false)
    }
  }

  const handleCreate = () => void createWith(picked?.ticker ?? form.ticker.trim())

  const refreshListing = async () => {
    setListingBusy(true)
    setNotice(null)
    try {
      const result = await api.refreshSymbolListing()
      api.getListingStatus().then(setListing).catch(() => {})
      setNotice(
        result.ok
          ? { tone: 'green', text: `국내 상장목록 ${result.count.toLocaleString('ko-KR')}종목을 받았습니다. 신규 상장·사명 변경이 검색에 반영됩니다.` }
          : { tone: 'amber', text: result.hint ?? '상장목록을 받지 못했습니다.', detail: result.error },
      )
    } catch (e) {
      setError(e)
    } finally {
      setListingBusy(false)
    }
  }

  const targetSum =
    stocks.filter((s) => s.active).reduce((sum, s) => sum + s.target_weight_pct, 0) + cashTarget
  // 평단가는 그 종목을 실제로 거래하는 통화 기준이므로, 고른 종목에 맞춰 단위를 보여준다
  const newMarket = picked?.market ?? 'US'
  const newCurrencyMeta = CURRENCY_META[CURRENCY_BY_MARKET[newMarket]]

  return (
    <div>
      <datalist id="category-options">
        {CATEGORY_SUGGESTIONS.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>

      <div className="page-head">
        <div>
          <h2>종목 관리</h2>
          <p className="hint">
            종목을 추가하면 전체 히스토리를 내려받아 지표·시그널을 계산합니다. 국내주식은 종목명(삼성전자)이나
            종목코드(005930)로, 해외주식은 티커(VOO)로 찾을 수 있습니다. 구분(지수/알파/안전자산 등)은
            자유 입력이며 대시보드 필터로 쓰입니다.
          </p>
        </div>
      </div>

      <ErrorNotice error={error} onDismiss={() => setError(null)} />
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

      <div className="panel">
        <div className="section-head">
          <h3>관심 종목 추가</h3>
          {/* 상장 목록은 전원이 같이 쓴다 — 받아오는 건 관리자만 */}
          {isAdmin && (
            <button className="ghost sm" onClick={() => void refreshListing()} disabled={listingBusy}>
              {listingBusy ? '받는 중…' : '거래소 목록 갱신'}
            </button>
          )}
          <span className="hint">{listingHint(listing)}</span>
        </div>
        <div className="form-grid">
          <div className="field field-wide">
            <label htmlFor="new-ticker">종목 검색</label>
            <SymbolSearch
              selected={picked}
              onSelect={setPicked}
              onSubmitRaw={(typed) => void createWith(typed)}
              disabled={creating}
            />
          </div>
          <div className="field">
            <label htmlFor="new-category">구분</label>
            <input
              id="new-category"
              type="text"
              list="category-options"
              placeholder="지수"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="new-weight">목표 비중 (%)</label>
            <NumberInput
              id="new-weight"
              placeholder="0"
              value={form.targetWeight}
              onChange={(v) => setForm({ ...form, targetWeight: v })}
            />
          </div>
          <div className="field">
            <label htmlFor="new-quantity">보유 수량</label>
            <NumberInput
              id="new-quantity"
              placeholder="0"
              value={form.quantity}
              onChange={(v) => setForm({ ...form, quantity: v })}
              // 미국 주식은 소수점 단위로도 산다
              allowDecimal={newMarket === 'US'}
            />
          </div>
          <div className="field">
            <label htmlFor="new-cost">평단가 ({newCurrencyMeta.symbol})</label>
            <NumberInput
              id="new-cost"
              placeholder="모르면 비워두기"
              value={form.avgCost}
              onChange={(v) => setForm({ ...form, avgCost: v })}
              // 원·엔은 소수점이 의미가 없다
              allowDecimal={newMarket === 'US'}
            />
          </div>
          <div className="field">
            <label>&nbsp;</label>
            <button className="primary" onClick={handleCreate} disabled={creating}>
              {creating ? '추가하는 중…' : '+ 종목 추가'}
            </button>
          </div>
        </div>
        <p className="hint" style={{ marginTop: 10 }}>
          목표 비중은 <b>현금을 포함한 전체 자금</b> 중 이 종목에 둘 비중입니다. 이미 들고 있는 종목이면 수량과
          평단가를 같이 적으세요 — 평단가는 {newCurrencyMeta.label} 기준이고 손익을 보여주는 데만 쓰이며 비중에는
          영향이 없습니다. 수량·평단가는 나중에 리밸런싱 탭에서 고칠 수 있습니다. 시세 조회에 실패해도 종목
          등록은 유지되며 나중에 다시 갱신할 수 있습니다.
        </p>
      </div>

      <div className="section">
        <div className="section-head">
          <h3>등록된 종목 {stocks.length}개</h3>
          <span className={`badge ${Math.abs(targetSum - 100) < 0.01 ? 'badge-green' : 'badge-amber'}`}>
            목표 비중 합계 {targetSum.toFixed(1)}%
            {cashTarget > 0 && ` (현금 ${cashTarget.toFixed(1)}% 포함)`}
          </span>
        </div>

        {stocks.length === 0 ? (
          <div className="empty-state">
            <h3>등록된 종목이 없습니다</h3>
            <p>위 검색창에 종목명(삼성전자)이나 티커(VOO)를 입력해 추가해주세요.</p>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="data-table fixed" style={{ minWidth: 890 }}>
              <thead>
                <tr>
                  <th style={{ width: 202 }}>종목</th>
                  <th style={{ width: 108 }}>구분</th>
                  <th style={{ width: 132 }}>목표 비중</th>
                  <th style={{ width: 148 }}>
                    밴드 임계값
                    <br />
                    (비워두면 기본값)
                  </th>
                  <th style={{ width: 300 }}>작업</th>
                </tr>
              </thead>
              <tbody>
                {stocks.map((s) => (
                  <StockRow
                    key={s.ticker}
                    stock={s}
                    onSaved={handleSaved}
                    onError={setError}
                    onPurge={setPurging}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {purging && (
        <ConfirmDialog
          title={`${stockLabel(purging)} 삭제`}
          confirmLabel="네, 완전히 지웁니다"
          busyLabel="지우는 중…"
          busy={purgeBusy}
          onConfirm={() => void purge(purging)}
          onCancel={() => setPurging(null)}
        >
          <p>
            <strong>{stockLabel(purging)}</strong>({purging.ticker})의 보유수량·평단가와 시세·지표까지 전부
            지웁니다. 되돌릴 수 없고, 다시 등록하면 히스토리를 처음부터 새로 받아야 합니다. 이미 남긴
            리밸런싱 기록은 그대로 둡니다.
          </p>
          <p>
            잠시 목록에서만 내리려는 것이라면 <strong>비활성화</strong>를 쓰세요. 기록은 그대로 남고
            언제든 다시 켤 수 있습니다.
          </p>
        </ConfirmDialog>
      )}
    </div>
  )
}
