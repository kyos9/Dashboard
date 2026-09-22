import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import { ErrorNotice } from '../components/ErrorNotice'
import { MacroChartModal } from '../components/MacroChartModal'
import { useAppState } from '../AppState'
import {
  FREQUENCY_LABEL,
  checkedLabel,
  macroChange,
  macroValue,
  statusOf,
  zoneTone,
} from '../lib/macro'
import type { MacroBadge, MacroOverview, MacroSeriesInfo, TermSpread } from '../types'

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
export function TermSpreadLine({ spread }: { spread: TermSpread | null }) {
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
    </div>
  )
}

/**
 * 국면 배지 줄.
 *
 * **합쳐서 점수 하나로 만들지 않는다.** "매크로 62점"을 만드는 순간 왜 62인지 아무도
 * 모르게 되고, 근거가 안 보이는 숫자는 판단에 도움이 안 된다. 규칙 하나가 배지 하나라야
 * 이유가 그대로 보인다 (`services/regime.py`).
 *
 * 아무것도 안 걸려도 자리를 비우지 않는다 — "조용하다"도 알아야 할 정보고, 빈 자리는
 * "아직 안 불러왔나"로 보인다.
 */
export function RegimeRow({ badges }: { badges: MacroBadge[] }) {
  if (badges.length === 0) {
    return <p className="hint regime-quiet">지금 눈에 띄는 국면은 없습니다.</p>
  }
  return (
    <div className="regime-row">
      {badges.map((badge) => (
        <span key={badge.key} className={`badge badge-${badge.tone} regime-badge`}>
          {badge.label}
          <span className="regime-detail">{badge.detail}</span>
        </span>
      ))}
    </div>
  )
}

function MacroCard({
  series,
  pinned,
  onOpen,
  onTogglePin,
}: {
  series: MacroSeriesInfo
  pinned: boolean
  onOpen: () => void
  onTogglePin: () => void
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
        <button
          className={`pin-btn${pinned ? ' on' : ''}`}
          onClick={onTogglePin}
          aria-pressed={pinned}
          title={pinned ? '홈 화면에서 내리기' : '홈 화면에 올리기'}
          aria-label={`${series.name} 홈 화면에 올리기`}
        >
          {pinned ? '★' : '☆'}
        </button>
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

  const series = data?.series ?? []
  const pinned = data?.pinned ?? []

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
        <button className="primary" onClick={() => void refresh()} disabled={refreshing}>
          {refreshing ? '받는 중…' : '지금 받아오기'}
        </button>
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
          <RegimeRow badges={data?.badges ?? []} />
          <TermSpreadLine spread={data?.term_spread ?? null} />
          <div className="card-grid">
            {series.map((item) => (
              <MacroCard
                key={item.code}
                series={item}
                pinned={pinned.includes(item.code)}
                onOpen={() => setOpen(item)}
                onTogglePin={() => void togglePin(item.code)}
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
