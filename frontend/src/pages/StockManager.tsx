import { useEffect, useState } from 'react'
import { useAppState } from '../AppState'
import { api } from '../api/client'
import { ErrorNotice } from '../components/ErrorNotice'
import { SymbolSearch } from '../components/SymbolSearch'
import { CURRENCY_META, MARKET_LABEL, money } from '../lib/display'
import type {
  ListingStatus,
  DcaPeriod,
  RebalancePeriod,
  Stock,
  StockCreateInput,
  SymbolMatch,
} from '../types'

const emptyForm: StockCreateInput = {
  ticker: '',
  name: '',
  category: '',
  dca_amount: 0,
  dca_period: 'monthly',
  rebalance_period: 'quarterly',
  target_weight_pct: 0,
}

/** 구분 입력을 돕는 예시값 — 자유 입력이므로 강제되지 않는다 */
const CATEGORY_SUGGESTIONS = ['지수', '알파', '안전자산']

function StockRow({ stock, onSaved, onError }: { stock: Stock; onSaved: () => void; onError: (e: unknown) => void }) {
  const [name, setName] = useState(stock.name ?? '')
  const [category, setCategory] = useState(stock.category ?? '')
  const [dcaAmount, setDcaAmount] = useState(String(stock.dca_amount))
  const [dcaPeriod, setDcaPeriod] = useState<DcaPeriod>(stock.dca_period)
  const [rebalancePeriod, setRebalancePeriod] = useState<RebalancePeriod>(stock.rebalance_period)
  const [targetWeight, setTargetWeight] = useState(String(stock.target_weight_pct))
  const [bandPct, setBandPct] = useState(stock.rebalance_band_pct === null ? '' : String(stock.rebalance_band_pct))
  const [reviewOverride, setReviewOverride] = useState(stock.review_date_override ?? '')
  const [saving, setSaving] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const save = async () => {
    setSaving(true)
    try {
      await api.updateStock(stock.ticker, {
        name: name.trim() === '' ? undefined : name.trim(),
        category: category.trim() === '' ? null : category.trim(),
        dca_amount: Number(dcaAmount),
        dca_period: dcaPeriod,
        rebalance_period: rebalancePeriod,
        target_weight_pct: Number(targetWeight),
        rebalance_band_pct: bandPct === '' ? null : Number(bandPct),
        review_date_override: reviewOverride === '' ? null : reviewOverride,
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
          <span className="ticker-name mono">{stock.ticker}</span>
          <span className="ticker-sub">
            {MARKET_LABEL[stock.market]} · {CURRENCY_META[stock.currency].symbol}
            {stock.currency}
          </span>
          {!stock.active && <span className="badge badge-grey">비활성</span>}
        </div>
      </td>
      <td>
        <input type="text" value={name} placeholder="표시 이름" onChange={(e) => setName(e.target.value)} />
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
        <div className="input-with-button">
          <span className="unit">{CURRENCY_META[stock.currency].symbol}</span>
          <input type="number" step="any" value={dcaAmount} onChange={(e) => setDcaAmount(e.target.value)} />
          <select value={dcaPeriod} onChange={(e) => setDcaPeriod(e.target.value as DcaPeriod)} style={{ width: 74 }}>
            <option value="monthly">월</option>
            <option value="quarterly">분기</option>
          </select>
        </div>
      </td>
      <td>
        <div className="input-with-button">
          <input type="number" step="any" value={targetWeight} onChange={(e) => setTargetWeight(e.target.value)} />
          <span className="unit">%</span>
        </div>
      </td>
      <td>
        <select
          value={rebalancePeriod}
          onChange={(e) => setRebalancePeriod(e.target.value as RebalancePeriod)}
        >
          <option value="quarterly">분기</option>
          <option value="semiannual">반기</option>
        </select>
      </td>
      <td>
        <div className="input-with-button">
          <input
            type="number"
            step="any"
            placeholder="기본값"
            value={bandPct}
            onChange={(e) => setBandPct(e.target.value)}
          />
          <span className="unit">%p</span>
        </div>
      </td>
      <td>
        <input type="date" value={reviewOverride} onChange={(e) => setReviewOverride(e.target.value)} />
      </td>
      <td>
        <div className="btn-group">
          <button className="primary sm" onClick={save} disabled={saving}>
            {saving ? '저장 중…' : '저장'}
          </button>
          <button className="sm" onClick={refresh} disabled={refreshing}>
            {refreshing ? '갱신 중…' : '시세 갱신'}
          </button>
          <button className="sm ghost" onClick={toggleActive}>
            {stock.active ? '비활성화' : '활성화'}
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
  const [stocks, setStocks] = useState<Stock[]>([])
  const [form, setForm] = useState<StockCreateInput>(emptyForm)
  const [error, setError] = useState<unknown>(null)
  const [notice, setNotice] = useState<{ tone: 'green' | 'amber'; text: string; detail?: string } | null>(null)
  const [creating, setCreating] = useState(false)
  const [picked, setPicked] = useState<SymbolMatch | null>(null)
  const [listingBusy, setListingBusy] = useState(false)
  const [listing, setListing] = useState<ListingStatus | null>(null)

  useEffect(() => {
    api
      .listStocks()
      .then(setStocks)
      .catch(setError)
  }, [refreshKey])

  // 지금 무엇으로 검색되는지는 "왜 이 종목이 안 나오지?"의 답이므로 화면에 띄워둔다.
  // 실패해도 검색 자체는 되므로 오류로 처리하지 않는다.
  useEffect(() => {
    api.getListingStatus().then(setListing).catch(() => setListing(null))
  }, [refreshKey])

  const handleSaved = () => {
    setError(null)
    notifyDataChanged()
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
      const result = await api.createStock({
        ...form,
        ticker: query,
        name: form.name?.trim() === '' ? undefined : form.name,
        category: form.category?.trim() === '' ? null : form.category,
      })
      setForm(emptyForm)
      setPicked(null)

      // 이름으로 등록했으면 어떤 티커로 해석됐는지 보여준다
      const label = result.resolved_from
        ? `${result.resolved_from} → ${result.stock.ticker}`
        : result.stock.ticker

      setNotice(
        result.data_loaded
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

  const handleCreate = () => void createWith(picked?.ticker ?? (form.ticker ?? '').trim())

  const refreshListing = async () => {
    setListingBusy(true)
    setNotice(null)
    try {
      const result = await api.refreshSymbolListing()
      api.getListingStatus().then(setListing).catch(() => {})
      setNotice(
        result.ok
          ? { tone: 'green', text: `한국거래소 상장목록 ${result.count.toLocaleString('ko-KR')}종목을 받았습니다. 신규 상장·사명 변경이 검색에 반영됩니다.` }
          : { tone: 'amber', text: result.hint ?? '상장목록을 받지 못했습니다.', detail: result.error },
      )
    } catch (e) {
      setError(e)
    } finally {
      setListingBusy(false)
    }
  }

  const targetSum = stocks.filter((s) => s.active).reduce((sum, s) => sum + s.target_weight_pct, 0)
  // DCA 금액은 그 종목을 실제로 거래하는 통화 기준이므로, 고른 종목에 맞춰 단위를 보여준다
  const newCurrencyMeta = CURRENCY_META[picked?.market === 'KR' ? 'KRW' : 'USD']

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
          <button className="ghost sm" onClick={() => void refreshListing()} disabled={listingBusy}>
            {listingBusy ? '받는 중…' : '거래소 목록 갱신'}
          </button>
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
            <label htmlFor="new-name">표시 이름</label>
            <input
              id="new-name"
              type="text"
              placeholder="S&P 500 ETF"
              value={form.name ?? ''}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="new-category">구분</label>
            <input
              id="new-category"
              type="text"
              list="category-options"
              placeholder="지수"
              value={form.category ?? ''}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="new-amount">DCA 금액 ({newCurrencyMeta.symbol})</label>
            <input
              id="new-amount"
              type="number"
              step="any"
              value={form.dca_amount}
              onChange={(e) => setForm({ ...form, dca_amount: Number(e.target.value) })}
            />
          </div>
          <div className="field">
            <label htmlFor="new-period">DCA 주기</label>
            <select
              id="new-period"
              value={form.dca_period}
              onChange={(e) => setForm({ ...form, dca_period: e.target.value as DcaPeriod })}
            >
              <option value="monthly">월</option>
              <option value="quarterly">분기</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="new-weight">목표 비중 (%)</label>
            <input
              id="new-weight"
              type="number"
              step="any"
              value={form.target_weight_pct}
              onChange={(e) => setForm({ ...form, target_weight_pct: Number(e.target.value) })}
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
          DCA 금액 {newCurrencyMeta.symbol}
          {money(form.dca_amount ?? 0)}을(를) {form.dca_period === 'monthly' ? '매월' : '매 분기'} 매수하는 것으로
          기록합니다. 금액은 해당 종목을 실제로 거래하는 통화({newCurrencyMeta.label}) 기준입니다. 시세 조회에
          실패해도 종목 등록은 유지되며 나중에 다시 갱신할 수 있습니다.
        </p>
      </div>

      <div className="section">
        <div className="section-head">
          <h3>등록된 종목 {stocks.length}개</h3>
          <span className={`badge ${Math.abs(targetSum - 100) < 0.01 ? 'badge-green' : 'badge-amber'}`}>
            활성 종목 목표 비중 합계 {targetSum.toFixed(1)}%
          </span>
        </div>

        {stocks.length === 0 ? (
          <div className="empty-state">
            <h3>등록된 종목이 없습니다</h3>
            <p>위 검색창에 종목명(삼성전자)이나 티커(VOO)를 입력해 추가해주세요.</p>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="data-table" style={{ minWidth: 1260 }}>
              <thead>
                <tr>
                  <th style={{ minWidth: 92 }}>티커</th>
                  <th style={{ minWidth: 130 }}>표시 이름</th>
                  <th style={{ minWidth: 104 }}>구분</th>
                  <th style={{ minWidth: 215 }}>DCA 금액 / 주기</th>
                  <th style={{ minWidth: 155 }}>목표 비중</th>
                  <th style={{ minWidth: 92 }}>
                    리밸런싱
                    <br />
                    주기
                  </th>
                  <th style={{ minWidth: 155 }}>
                    밴드 임계값
                    <br />
                    (비워두면 기본값)
                  </th>
                  <th style={{ minWidth: 140 }}>
                    리뷰 마감일
                    <br />
                    직접 지정
                  </th>
                  <th style={{ minWidth: 210 }}>작업</th>
                </tr>
              </thead>
              <tbody>
                {stocks.map((s) => (
                  <StockRow key={s.ticker} stock={s} onSaved={handleSaved} onError={setError} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
