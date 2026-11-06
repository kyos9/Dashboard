import { useState } from 'react'
import { api } from '../../api/client'
import { useAppState } from '../../AppState'
import { useCachedLoad } from '../../lib/cache'
import { avgPrice, num, qty, savedStocksText, stockLabel } from '../../lib/display'
import { fxUnitLabel } from '../../lib/fxInput'
import type { Holding, Stock } from '../../types'
import { ConfirmDialog } from '../ConfirmDialog'
import { ErrorNotice } from '../ErrorNotice'
import { StockEditModal } from '../StockEditModal'
import { Icon } from '../icons/Icon'

/**
 * 종목 안 "보유" 탭 — 수량 · 평단가 · 구분 · 목표 비중 · 밴드를 보이고, 고치기는 "종목 한 번에 수정" 팝업을
 * 이 종목 칸에 커서를 둔 채로 연다(같은 팝업 — 고치는 곳이 둘이 되지 않게, ROADMAP 9-11).
 * 예전 종목 관리 표의 줄마다 있던 일(시세 갱신 · 비활성화 · 삭제)도 여기로 왔다 — 그 종목에만 하는 일이다.
 */
export function HoldingTab({ ticker, onPurged }: { ticker: string; onPurged?: () => void }) {
  const { refreshKey, notifyDataChanged } = useAppState()
  const [stocks, setStocks] = useState<Stock[] | null>(null)
  const [holdings, setHoldings] = useState<Map<string, Holding>>(new Map())
  const [cashTarget, setCashTarget] = useState(0)
  const [error, setError] = useState<unknown>(null)
  const [notice, setNotice] = useState('')
  const [editing, setEditing] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [purging, setPurging] = useState(false)
  const [purgeBusy, setPurgeBusy] = useState(false)

  // 종목 탭과 같은 캐시 칸 — 탭을 오가도 다시 비지 않게 (ROADMAP 8-1)
  useCachedLoad('page:stocks', api.listStocks, setStocks, setError, [refreshKey])
  useCachedLoad(
    'page:stocks:holdings',
    api.listHoldings,
    (list) => setHoldings(new Map(list.map((h) => [h.ticker, h]))),
    () => setHoldings(new Map()),
    [refreshKey],
  )
  useCachedLoad('page:stocks:settings', api.getSettings, (s) => setCashTarget(s.cash_target_pct), () => setCashTarget(0), [refreshKey])

  const stock = stocks?.find((s) => s.ticker === ticker)
  if (stocks === null) return <p className="hint detail-empty">불러오는 중…</p>
  if (!stock) return <p className="hint detail-empty">내 종목에 없는 종목입니다. 종목 탭에서 찾아 추가하면 보유를 적을 수 있습니다.</p>

  const holding = holdings.get(ticker)
  const label = stockLabel(stock)
  const held = !!holding && holding.quantity > 0

  const refresh = async () => {
    setRefreshing(true)
    setError(null)
    setNotice('')
    try {
      const result = await api.refreshStock(ticker)
      // 같은 종목은 10분에 한 번만 실제로 받는다 — 거절이 아니라 언제 받았는지를 알린다
      setNotice(result.skipped ? `${label}: ${result.hint ?? '최근에 받았습니다.'}` : `${label} 시세를 새로 받았습니다.`)
      notifyDataChanged()
    } catch (e) {
      setError(e)
    } finally {
      setRefreshing(false)
    }
  }

  const toggleActive = async () => {
    setError(null)
    try {
      if (stock.active) await api.deactivateStock(ticker)
      else await api.updateStock(ticker, { active: true })
      notifyDataChanged()
    } catch (e) {
      setError(e)
    }
  }

  /** 종목과 딸린 기록을 전부 지운다. 되돌릴 수 없으므로 한 번 더 묻고 나서 온다. */
  const purge = async () => {
    setPurgeBusy(true)
    setError(null)
    try {
      await api.purgeStock(ticker)
      setPurging(false)
      notifyDataChanged()
      onPurged?.()
    } catch (e) {
      setError(e)
      setPurging(false)
    } finally {
      setPurgeBusy(false)
    }
  }

  return (
    <div className="stock-holding">
      <ErrorNotice error={error} onDismiss={() => setError(null)} />
      {notice && (
        <p className="hint saved-note" role="status">
          ✓ {notice}
        </p>
      )}
      <section className="detail-card">
        <div className="detail-card-head">
          <h3 className="detail-card-title">보유</h3>
          <button type="button" className="ghost sm detail-card-action" onClick={() => setEditing(true)} aria-label={`${label} 보유 고치기`}>
            <Icon name="edit" size={16} /> 고치기
          </button>
        </div>
        <dl className="detail-kv">
          <div>
            <dt>수량</dt>
            <dd className="mono">{held ? `${qty(holding!.quantity)}주` : <span className="hint">보유 없음</span>}</dd>
          </div>
          <div>
            <dt>평단가</dt>
            <dd className="mono">{held && holding!.avg_cost !== null ? avgPrice(holding!.avg_cost, stock.currency) : <span className="hint">—</span>}</dd>
          </div>
          {stock.currency !== 'KRW' && (
            <div>
              <dt>산 환율</dt>
              <dd className="mono">
                {held && holding!.avg_fx ? // 엔은 100엔 값으로 받고 보인다(입력과 같은 단위, ROADMAP 8-3)
                  `${num(stock.currency === 'JPY' ? holding!.avg_fx * 100 : holding!.avg_fx, 2)} ${fxUnitLabel(stock.currency)}` : <span className="hint">—</span>}
              </dd>
            </div>
          )}
          <div>
            <dt>구분</dt>
            <dd>{stock.category ?? <span className="hint">없음</span>}</dd>
          </div>
          <div>
            <dt>목표 비중</dt>
            <dd className="mono">{num(stock.target_weight_pct, 1)}%</dd>
          </div>
          <div>
            <dt>밴드</dt>
            <dd className="mono">{stock.rebalance_band_pct === null ? <span className="hint">기본값</span> : `±${num(stock.rebalance_band_pct, 1)}%p`}</dd>
          </div>
        </dl>
        {!held && <p className="hint">관심 종목입니다 — 수량을 넣으면 홈 · 리밸런싱의 보유로 들어갑니다.</p>}
      </section>

      <section className="detail-card">
        <h3 className="detail-card-title">이 종목</h3>
        <p className="hint">
          {stock.active ? '켜져 있습니다 — 홈 · 시그널 · 리밸런싱에 나옵니다.' : '비활성 — 기록은 남고 홈 · 시그널 · 리밸런싱에서 빠집니다.'}
          {stock.data_status === 'failed' && ` 시세를 받지 못했습니다${stock.data_hint ? ` — ${stock.data_hint}` : ''}.`}
        </p>
        <div className="btn-group detail-actions">
          <button type="button" onClick={() => void refresh()} disabled={refreshing} aria-label={`${label} 시세 갱신`}>
            {refreshing ? '갱신 중…' : '시세 갱신'}
          </button>
          <button type="button" className="ghost" onClick={() => void toggleActive()} aria-label={`${label} ${stock.active ? '비활성화' : '활성화'}`}>
            {stock.active ? '비활성화' : '활성화'}
          </button>
          <button type="button" className="danger" onClick={() => setPurging(true)} aria-label={`${label} 삭제`}>
            삭제
          </button>
        </div>
      </section>

      {editing && stocks && (
        <StockEditModal
          stocks={stocks}
          holdings={holdings}
          cashTargetPct={cashTarget}
          focus={{ ticker, field: 'quantity' }}
          onClose={() => setEditing(false)}
          onSaved={(labels) => {
            setNotice(savedStocksText(labels))
            notifyDataChanged()
          }}
        />
      )}

      {purging && (
        <ConfirmDialog
          title={`${label} 삭제`}
          confirmLabel="네, 지웁니다"
          busyLabel="지우는 중…"
          busy={purgeBusy}
          onConfirm={() => void purge()}
          onCancel={() => setPurging(false)}
        >
          <p>
            <strong>{label}</strong>({ticker})을(를) 내 목록에서 빼고 보유수량·평단가를 지웁니다. 되돌릴 수 없습니다.
            시세·지표는 모두가 같이 쓰는 기록이라 남겨 두므로, 다시 등록하면 히스토리가 바로 보입니다. 이미 남긴 리밸런싱
            기록도 그대로 둡니다.
          </p>
          <p>
            잠시 목록에서만 내리려는 것이라면 <strong>비활성화</strong>를 쓰세요. 기록은 그대로 남고 언제든 다시 켤 수 있습니다.
          </p>
        </ConfirmDialog>
      )}
    </div>
  )
}
