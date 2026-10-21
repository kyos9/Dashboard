import { conditionMark } from '../lib/display'
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

export function BuyConditions({ card }: { card: DashboardCard }) {
  const rule = buyRule(useSignalRules())
  const conditions = orderedBuyConditions(rule.conditions)
  const states = cardConditions(card)
  const met = conditions.filter((c) => states[c.key] === true).length
  return (
    <div className="signal-row">
      <span className="signal-row-label">
        매수 조건{' '}
        <span className="nowrap mono">
          {met}/{conditions.length}
        </span>
      </span>
      <div className="signal-row-items">
        {conditions.map((condition) => {
          const state = states[condition.key]
          const mark = conditionMark(state)
          return (
            <span
              key={condition.key}
              className={`cond${state === true ? ' met' : ''}`}
              title={`${condition.detail} — ${mark.word}`}
              aria-label={`${condition.label} ${mark.word}`}
            >
              {mark.sign} {condition.label}
            </span>
          )
        })}
      </div>
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
export function SellConditions({ card }: { card: DashboardCard }) {
  const rule = sellRule(useSignalRules())
  if (!showsSellConditions(card)) return null
  const states = card.sell_conditions!
  const met = rule.conditions.filter((c) => states[c.key] === true).length
  return (
    <div className="signal-row sell-conditions">
      <span className="signal-row-label">
        매도 조건 (참고){' '}
        <span className="nowrap mono">
          {met}/{rule.conditions.length}
        </span>
      </span>
      <div className="signal-row-items">
        {rule.conditions.map((condition) => {
          const mark = conditionMark(states[condition.key])
          return (
            <span
              key={condition.key}
              className="cond"
              title={`${condition.detail} — ${mark.word}`}
              aria-label={`${condition.label} ${mark.word}`}
            >
              {mark.sign} {condition.label}
            </span>
          )
        })}
      </div>
    </div>
  )
}
