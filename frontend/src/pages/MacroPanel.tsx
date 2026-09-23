import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import { useAuth } from '../components/AuthGate'
import { ErrorNotice } from '../components/ErrorNotice'
import { MacroChartModal } from '../components/MacroChartModal'
import { NumberInput } from '../components/NumberInput'
import { RegimeBadges } from '../components/RegimeBadges'
import { useAppState } from '../AppState'
import {
  FREQUENCY_LABEL,
  checkedLabel,
  macroChange,
  macroValue,
  statusOf,
  zoneTone,
} from '../lib/macro'
import { TERM_SPREAD_CODE } from '../types'
import type { MacroOverview, MacroSeriesInfo, TermSpread } from '../types'

/**
 * 장단기 금리차 한 줄.
 *
 * 지표 카드와 따로 둔다 — 받아온 값이 아니라 두 금리에서 계산한 것이라 갱신 상태도
 * 발표일도 없고, 카드 사이에 끼면 "이건 왜 상태가 없나"로 보인다.
 *
 * 역전(마이너스)일 때만 눈에 띄게 한다. **그게 곧 팔라는 뜻은 아니다** — 역전은
 * 과거에 침체보다 1~2년 앞섰고, 그 사이에 주가가 더 오른 적도 많다. 그래서 문구는
 * "역전됐다"까지만 말하고 다음에 뭘 하라는 말은 하지 않는다.
 */
export function TermSpreadLine({
  spread,
  pinned,
  onTogglePin,
}: {
  spread: TermSpread | null
  pinned: boolean
  /** 없으면 별을 안 띄운다 (손님 — 즐겨찾기를 저장할 자리가 없다) */
  onTogglePin?: () => void
}) {
  if (!spread) {
    return (
      <p className="hint">
        장단기 금리차는 10년물과 2년물이 <b>같은 날</b> 값으로 있어야 계산됩니다 — 아직
        둘 중 하나가 안 들어왔습니다.
      </p>
    )
  }

  const inverted = spread.value < 0
  return (
    <div className={`callout ${inverted ? 'amber' : 'blue'}`}>
      <span className="ico" aria-hidden="true">
        {inverted ? '⚠' : '📐'}
      </span>
      <div>
        <b>
          장단기 금리차 {spread.value > 0 ? '+' : ''}
          {spread.value.toFixed(2)}%p
        </b>
        {inverted ? ' — 장단기 금리가 역전돼 있습니다.' : ' — 정상(장기 > 단기)입니다.'}
        <span className="hint">
          {' '}
          {spread.long_code} − {spread.short_code} · {spread.as_of} 기준
        </span>
      </div>
      {/* 받아온 지표가 아니라 계산값이지만 홈에서는 지표 하나처럼 켜고 끌 수 있다 */}
      {onTogglePin && (
        <button
          className={`pin-btn${pinned ? ' on' : ''}`}
          onClick={onTogglePin}
          aria-pressed={pinned}
          title={pinned ? '홈 화면에서 내리기' : '홈 화면에 올리기'}
          aria-label="장단기 금리차 홈 화면에 올리기"
        >
          {pinned ? '★' : '☆'}
        </button>
      )}
    </div>
  )
}

/** "2026-08-01" -> "2026-08". 값이 없으면 이번 달. */
function monthOf(asOf: string | null): string {
  if (asOf) return asOf.slice(0, 7)
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

/**
 * 입력칸에 처음 들어가 있을 달.
 *
 * **마지막 발표의 다음 달이다.** 예상치를 적는 때는 보통 발표 **전**이고, 그때 궁금한
 * 것은 아직 안 나온 달이다. 마지막 발표 달을 기본으로 두면 매번 한 칸씩 올려야 한다.
 */
function defaultMonth(series: MacroSeriesInfo): string {
  if (!series.as_of) return monthOf(null)
  const [year, month] = series.as_of.slice(0, 7).split('-').map(Number)
  const next = new Date(Date.UTC(year, month, 1))
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`
}

/**
 * 예상치 한 줄과 그 입력칸.
 *
 * 카드 안에 둔다. 설정 화면으로 보내면 어떤 값이 나왔는지 보면서 적을 수가 없고,
 * 예상치는 그 값 바로 옆에서만 뜻이 있다.
 */
function ForecastBox({
  series,
  editable,
  onSave,
  onClear,
}: {
  series: MacroSeriesInfo
  /** 예상치는 전원이 같이 보는 값이라 관리자만 넣는다. 나머지는 읽기만 */
  editable: boolean
  onSave: (code: string, month: string, value: number) => Promise<boolean>
  onClear: (code: string, month: string) => Promise<boolean>
}) {
  const [open, setOpen] = useState(false)
  const [month, setMonth] = useState(() => defaultMonth(series))
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)

  const { forecast, pending_forecast: pending } = series
  const number = Number(value)
  const canSave = value !== '' && value !== '-' && Number.isFinite(number)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!canSave || busy) return
    setBusy(true)
    const ok = await onSave(series.code, month, number)
    setBusy(false)
    if (ok) {
      setOpen(false)
      setValue('')
    }
  }

  const remove = async () => {
    if (busy) return
    setBusy(true)
    const ok = await onClear(series.code, month)
    setBusy(false)
    if (ok) {
      setOpen(false)
      setValue('')
    }
  }

  return (
    <>
      {forecast && (
        <p className="macro-forecast">
          예상 {macroValue(forecast.value, series.unit)}
          {forecast.surprise !== null && (
            /* 실제 − 예상. 색은 안 쓴다 — 물가가 높은 게 좋은 일인지는 무엇을 들고
               있느냐에 따라 다르고, 그 판단은 이 화면이 할 일이 아니다. */
            <span className="macro-surprise mono">
              실제 {macroChange(forecast.surprise, series.unit)}
            </span>
          )}
          <span className="hint"> {forecast.source_label}</span>
        </p>
      )}
      {pending && (
        <p className="macro-forecast">
          <span className="hint">{monthOf(pending.as_of)} 예상</span>{' '}
          {macroValue(pending.value, series.unit)}
          <span className="hint"> {pending.source_label} · 아직 발표 전</span>
        </p>
      )}

      {open ? (
        <form className="forecast-form" onSubmit={(event) => void submit(event)}>
          <label>
            <span className="hint">달</span>
            <input
              type="month"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
              aria-label={`${series.name} 예상치가 가리키는 달`}
            />
          </label>
          <label>
            <span className="hint">예상(%)</span>
            {/* 전년비는 마이너스가 될 수 있다 (2009·2015년 CPI) — 빼기표를 받는다 */}
            <NumberInput
              value={value}
              onChange={setValue}
              allowNegative
              placeholder="2.7"
              aria-label={`${series.name} 예상치`}
            />
          </label>
          <div className="forecast-actions">
            <button type="submit" className="primary" disabled={!canSave || busy}>
              저장
            </button>
            <button type="button" onClick={() => void remove()} disabled={busy}>
              지우기
            </button>
            <button type="button" onClick={() => setOpen(false)} disabled={busy}>
              닫기
            </button>
          </div>
        </form>
      ) : editable ? (
        <button
          className="link-btn forecast-open"
          onClick={() => {
            setMonth(defaultMonth(series))
            setValue('')
            setOpen(true)
          }}
        >
          예상치 입력
        </button>
      ) : null}
    </>
  )
}

function MacroCard({
  series,
  pinned,
  canEditForecast,
  onOpen,
  onTogglePin,
  onSaveForecast,
  onClearForecast,
}: {
  series: MacroSeriesInfo
  pinned: boolean
  canEditForecast: boolean
  onOpen: () => void
  /** 없으면 별을 안 띄운다 (손님) */
  onTogglePin?: () => void
  onSaveForecast: (code: string, month: string, value: number) => Promise<boolean>
  onClearForecast: (code: string, month: string) => Promise<boolean>
}) {
  const status = statusOf(series)
  const change = macroChange(series.change, series.unit)

  return (
    <div className="stock-card macro-card">
      <div className="stock-card-head">
        <div className="macro-card-name">
          <button className="link-btn macro-title" onClick={onOpen}>
            {series.name}
          </button>
          {series.note && <span className="ticker-sub">{series.note}</span>}
        </div>
        <div className="badge-row">
          {series.transform_label && (
            <span className="badge badge-blue">{series.transform_label}</span>
          )}
          {status && <span className={`badge ${status.tone}`}>{status.text}</span>}
        </div>
        {/* 홈에 올릴지. 켜고 끄는 자리를 지표 옆에 둔다 — 설정 화면으로 보내면 어떤
            지표가 있는지 보면서 고를 수가 없다. */}
        {onTogglePin && (
          <button
            className={`pin-btn${pinned ? ' on' : ''}`}
            onClick={onTogglePin}
            aria-pressed={pinned}
            title={pinned ? '홈 화면에서 내리기' : '홈 화면에 올리기'}
            aria-label={`${series.name} 홈 화면에 올리기`}
          >
            {pinned ? '★' : '☆'}
          </button>
        )}
      </div>

      <div className="macro-figure">
        <span className="big mono">{macroValue(series.value, series.unit)}</span>
        {change && <span className="macro-change mono">{change}</span>}
      </div>

      {/* 어느 구간인지. 점수만으로는 33.7이 높은지 낮은지 알 수 없고, 범위를 같이 적으면
          다음부터는 숫자만 보고도 읽힌다. 경계는 서버가 들고 있다 (`services/regime.py`). */}
      {series.zone && (
        <p className={`macro-zone ${zoneTone(series.zone)}`}>
          {series.zone.label} 구간
          <span className="macro-zone-range">{series.zone.range}</span>
        </p>
      )}

      {/* 예상치는 발표되는 지표에만 있다. VIX·금리는 매일 시장에서 나오는 값이라
          "예상 대비"라는 개념 자체가 없어서 입력칸도 안 띄운다. */}
      {series.forecastable && (
        <ForecastBox
          series={series}
          editable={canEditForecast}
          onSave={onSaveForecast}
          onClear={onClearForecast}
        />
      )}

      <p className="hint macro-foot">
        {series.as_of ? `${series.as_of} 기준` : '값 없음'}
        {' · '}
        {FREQUENCY_LABEL[series.frequency] ?? series.frequency}
        {series.released_at && ` · ${series.released_at} 발표`}
      </p>
      {/* "언제 받아본 것인가"는 "값이 언제 것인가"와 다른 질문이다. 둘 다 없으면
          날짜가 뒤처져 보일 때 출처 탓인지 우리 탓인지 가릴 수가 없다. */}
      <p className="hint macro-foot">
        {checkedLabel(series.last_checked_at)
          ? `${checkedLabel(series.last_checked_at)} 확인`
          : '받아본 적 없음'}
        {series.source && ` · ${series.source}`}
      </p>

      {series.last_error && (
        <details className="error-detail">
          <summary>왜 못 받았는지 보기</summary>
          <p>{series.last_error}</p>
        </details>
      )}
    </div>
  )
}

export function MacroPanel() {
  // 별을 켜고 끄면 홈의 매크로 줄이 달라진다. 홈이 그걸 알아야 다음에 열릴 때 다시 읽는다.
  const { notifyDataChanged } = useAppState()
  // 손님은 둘러보기만, 사용자는 별(내 홈)까지, 관리자는 받아오기·예상치(전원 것)까지
  const { guest, isAdmin } = useAuth()
  const [data, setData] = useState<MacroOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [open, setOpen] = useState<MacroSeriesInfo | null>(null)
  const [pinning, setPinning] = useState(false)

  const load = useCallback(async () => {
    try {
      setData(await api.getMacro())
    } catch (e) {
      setError(e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const refresh = async () => {
    setRefreshing(true)
    setError(null)
    try {
      await api.refreshMacro()
      await load()
    } catch (e) {
      setError(e)
    } finally {
      setRefreshing(false)
    }
  }

  /**
   * ☆ 를 켜고 끈다.
   *
   * 화면을 **먼저** 바꾸고 저장한다. 별은 누르면 바로 반응해야 하는 종류의 버튼이고,
   * 왕복을 기다리면 두 번 눌리기 십상이다. 실패하면 원래대로 되돌린다 — 되돌리지
   * 않으면 저장 안 된 별이 켜진 채로 남아서 홈에 왜 안 뜨는지 알 수 없게 된다.
   */
  const togglePin = async (code: string) => {
    if (!data || pinning) return
    const next = data.pinned.includes(code)
      ? data.pinned.filter((item) => item !== code)
      : [...data.pinned, code]

    const before = data.pinned
    setData({ ...data, pinned: next })
    setPinning(true)
    try {
      const saved = await api.setMacroPinned(next)
      setData((current) => (current ? { ...current, pinned: saved.codes } : current))
      // 홈이 다음에 열릴 때 새 목록을 읽게 한다
      notifyDataChanged()
    } catch (e) {
      setData((current) => (current ? { ...current, pinned: before } : current))
      setError(e)
    } finally {
      setPinning(false)
    }
  }

  /**
   * 예상치를 넣거나 지운 뒤.
   *
   * 화면 전체를 다시 읽는다. 바뀐 카드만 갈아끼우면 **배지가 안 따라온다** —
   * "물가 상회"는 예상치를 보고 뜨는 것이라, 예상치를 지웠는데 배지가 남아 있는
   * 화면이 된다. 요청 한 번이고 이 화면은 자주 여는 곳이 아니다.
   */
  const afterForecast = async (run: () => Promise<unknown>): Promise<boolean> => {
    setError(null)
    try {
      await run()
      await load()
      // 홈의 배지도 달라진다
      notifyDataChanged()
      return true
    } catch (e) {
      setError(e)
      return false
    }
  }

  const saveForecast = (code: string, month: string, value: number) =>
    // 입력칸은 달까지만 고르므로 그 달 1일로 보낸다 (값이 그렇게 저장돼 있다)
    afterForecast(() => api.setMacroForecast(code, `${month}-01`, value))

  const clearForecast = (code: string, month: string) =>
    afterForecast(() => api.clearMacroForecast(code, `${month}-01`))

  const series = data?.series ?? []
  const pinned = data?.pinned ?? []
  const badges = data?.badges ?? []

  return (
    <>
      <div className="page-head">
        <div>
          <h2>매크로 지표</h2>
          {/* 이 한 줄이 이 화면의 전부다. 여기 숫자는 매수·매도 판정에 들어가지 않는다 */}
          <p className="hint">
            지금이 어떤 국면인지 보는 곳입니다 — 여기 숫자는 매수·매도 시그널 판정에
            들어가지 않습니다.
          </p>
        </div>
        {isAdmin && (
          <button className="primary" onClick={() => void refresh()} disabled={refreshing}>
            {refreshing ? '받는 중…' : '지금 받아오기'}
          </button>
        )}
      </div>

      <ErrorNotice error={error} onDismiss={() => setError(null)} />

      {loading ? (
        <p className="hint">불러오는 중…</p>
      ) : series.length === 0 ? (
        <div className="empty-state">
          <h3>아직 지표가 없습니다</h3>
          <p>
            서버를 다시 띄우면 기본 지표 목록이 채워집니다. 그래도 비어 있으면
            <code> docker compose exec app python diagnose.py </code>
            로 어디서 막히는지 볼 수 있습니다.
          </p>
        </div>
      ) : (
        <>
          {badges.length > 0 ? (
            <RegimeBadges badges={badges} />
          ) : (
            /* 이 화면은 국면을 보러 오는 곳이라, 조용하면 조용하다고 적어야 한다.
               빈 자리는 "아직 안 불러왔나"로 보인다. */
            <p className="hint regime-quiet">지금 눈에 띄는 국면은 없습니다.</p>
          )}
          <TermSpreadLine
            spread={data?.term_spread ?? null}
            pinned={pinned.includes(TERM_SPREAD_CODE)}
            onTogglePin={guest ? undefined : () => void togglePin(TERM_SPREAD_CODE)}
          />
          <div className="card-grid">
            {series.map((item) => (
              <MacroCard
                key={item.code}
                series={item}
                pinned={pinned.includes(item.code)}
                canEditForecast={isAdmin}
                onOpen={() => setOpen(item)}
                onTogglePin={guest ? undefined : () => void togglePin(item.code)}
                onSaveForecast={saveForecast}
                onClearForecast={clearForecast}
              />
            ))}
          </div>
        </>
      )}

      {open && (
        <MacroChartModal code={open.code} name={open.name} onClose={() => setOpen(null)} />
      )}
    </>
  )
}
