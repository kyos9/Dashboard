import { useId, useState } from 'react'
import { conditionMark, conditionTitle } from '../lib/display'
import { buyRule, cardConditions, METRIC_ORDER, sellRule, showsSellConditions, useSignalRules } from '../lib/signalRules'
import type { DashboardCard, SignalRuleCondition } from '../types'

/**
 * 매수 조건 한 줄 — "매수 조건 1/4  · 이격도 < 0  ✓ ADX > 20 …" (디자인 2차).
 *
 * 예전 카드는 조건 칩을 지표 칸마다 붙였다. 그러면 "거래량 한산" 바로 밑에 ✓ "변동성·거래량"이 와서
 * 숫자와 판정이 어긋나 보였고(변동성 쪽이 참이라서), 칸이 없는 조건은 아예 그려지지 않았다.
 * 이제 규칙의 조건을 **전부** 한 줄에 흐르는 칩으로 — 셋이든 다섯이든 줄이 꺾일 뿐이다.
 * 순서는 표의 칸 순서와 설명 줄과 같게(`METRIC_ORDER`, 칸이 없는 조건은 뒤에 받은 순서대로).
 * 이름·풀이는 규칙에서 온다 — 기준 숫자를 여기 적지 않는다.
 *
 * 카드(대시보드)와 차트 팝업이 같이 쓴다. 바깥 `.signal-rows` 격자 안에 한 줄로 들어간다.
 */
function orderedBuyConditions(conditions: SignalRuleCondition[]): SignalRuleCondition[] {
  const rank = (metric: string) => {
    const i = METRIC_ORDER.indexOf(metric)
    return i === -1 ? METRIC_ORDER.length : i
  }
  return [...conditions].sort((a, b) => rank(a.metric) - rank(b.metric))
}


/**
 * 줄 이름표 — 차트 팝업(`explain`)에서는 단추: 누르면 그 줄 조건 전부의 풀이가 아래에 펼쳐진다 (0.45.3 D).
 * 칩 풀이가 마우스를 올려야(title) 보여 폰에서 못 봤고, 지난 날을 눌러도 칩은 오늘 것인데 날짜가 없었다.
 * 칩마다 누르게 하면 칩마다 44px 라 폰 팝업 높이를 못 지켰다(계획 검토 막음) — 줄마다 단추 하나. 이름표는 두 줄("매수 조건" / "2/4 ▾")로
 * 칸 폭을 지금과 비슷하게 둔다(넓어지면 칩이 세 줄로 넘어가 날짜 축이 밖으로 — 다시 보기). 카드(대시보드)는 단추가 아니다(카드 높이 그대로).
 */
function RowLabel({
  name,
  count,
  date,
  explain,
  open,
  panelId,
  onToggle,
}: {
  name: string
  count: string
  /** 칩이 어느 날 지표의 것인가 — 차트 팝업에서만 */
  date?: string | null
  explain: boolean
  open: boolean
  panelId: string
  onToggle: () => void
}) {
  if (!explain) {
    return (
      <span className="signal-row-label">
        {name} <span className="nowrap mono">{count}</span>
      </span>
    )
  }
  return (
    <button
      type="button"
      className="signal-row-label cond-toggle"
      aria-expanded={open}
      aria-controls={panelId}
      onClick={onToggle}
    >
      <span>{name}</span>
      <span className="nowrap">
        <span className="mono">{count}</span>
        {/* 기준일을 접힌 채로도 — 차트에서 지난 날을 골라도 칩은 이 날의 것인데 펼쳐야만 보였다(사용자 확인) */}
        {date && <span className="mono"> · {date.slice(5)}</span>} <span aria-hidden="true">{open ? '▴' : '▾'}</span>
      </span>
    </button>
  )
}

/** 펼친 풀이 — 맨 위에 기준일(칩은 그 날 지표의 것이다), 줄마다 "✓ 충족 · 이름: 풀이". 서버 풀이는 화면에서만 다듬는다(이음표 → 쉼표) */
function Explain({
  id,
  date,
  conditions,
  states,
}: {
  id: string
  date: string | null | undefined
  conditions: SignalRuleCondition[]
  states: Record<string, boolean | null | undefined>
}) {
  return (
    <div className="cond-explain" id={id}>
      {date && <p className="hint">{date.slice(5)} 기준 · 차트에서 다른 날을 골라도 이 날의 조건입니다</p>}
      <ul>
        {conditions.map((condition) => {
          const mark = conditionMark(states[condition.key])
          return (
            <li key={condition.key}>
              <span className="nowrap">
                {mark.sign} {mark.word}
              </span>{' '}
              · <b>{condition.label}</b>: {condition.detail.replace(/\s+—\s+/g, ', ')}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export function BuyConditions({ card, explain = false }: { card: DashboardCard; explain?: boolean }) {
  const rule = buyRule(useSignalRules())
  const conditions = orderedBuyConditions(rule.conditions)
  const states = cardConditions(card)
  const met = conditions.filter((c) => states[c.key] === true).length
  const [open, setOpen] = useState(false)
  const panelId = useId()
  return (
    <div className="signal-row">
      <RowLabel
        name="매수 조건"
        count={`${met}/${conditions.length}`}
        date={card.indicators?.date}
        explain={explain}
        open={open}
        panelId={panelId}
        onToggle={() => setOpen((o) => !o)}
      />
      <div className="signal-row-items">
        {conditions.map((condition) => {
          const state = states[condition.key]
          const mark = conditionMark(state)
          return (
            <span
              key={condition.key}
              className={`cond${state === true ? ' met' : ''}`}
              title={conditionTitle(condition.detail, mark.word)}
              aria-label={`${condition.label} ${mark.word}`}
            >
              {mark.sign} {condition.label}
            </span>
          )
        })}
      </div>
      {explain && open && <Explain id={panelId} date={card.indicators?.date} conditions={conditions} states={states} />}
    </div>
  )
}

/**
 * 매도 조건 (참고) 한 줄 — 차트 팝업에서만, **매도(참고) 신호가 켜진 날만** (0.45.0 C, 주인 결정).
 *
 * 꺼진 날 "2/3"을 보이면 "매도까지 하나 남음"으로 읽히고, 매수 4/4 옆의 "매도 1/3"은 초보에게 반대 신호로
 * 읽힌다(계획 검토). 그래서 신호가 있는 날 그 근거만 보인다. 칩은 **회색 그대로**(충족도 초록·빨강이 아니다) —
 * 팔라로 읽히는 색을 쓰지 않는다(규제 3절). 조건 이름·풀이는 서버 규칙 그대로, 명령하는 말은 넣지 않는다.
 * 판정 날짜와 지표 날짜가 다르면 서버가 null 을 보낸다 — 배지와 다른 날의 근거는 그리지 않는다. 옛 서버도 그리지 않는다.
 * 판정 불가가 섞인 날도 그리지 않는다(`showsSellConditions`).
 */
export function SellConditions({ card, explain = false }: { card: DashboardCard; explain?: boolean }) {
  const rule = sellRule(useSignalRules())
  const [open, setOpen] = useState(false)
  const panelId = useId()
  if (!showsSellConditions(card)) return null
  const states = card.sell_conditions!
  const met = rule.conditions.filter((c) => states[c.key] === true).length
  return (
    <div className="signal-row sell-conditions">
      <RowLabel
        name="매도 조건 (참고)"
        count={`${met}/${rule.conditions.length}`}
        date={card.indicators?.date}
        explain={explain}
        open={open}
        panelId={panelId}
        onToggle={() => setOpen((o) => !o)}
      />
      <div className="signal-row-items">
        {rule.conditions.map((condition) => {
          const mark = conditionMark(states[condition.key])
          return (
            <span
              key={condition.key}
              className="cond"
              title={conditionTitle(condition.detail, mark.word)}
              aria-label={`${condition.label} ${mark.word}`}
            >
              {mark.sign} {condition.label}
            </span>
          )
        })}
      </div>
      {explain && open && <Explain id={panelId} date={card.indicators?.date} conditions={rule.conditions} states={states} />}
    </div>
  )
}
