import type { MacroBadge } from '../types'

/**
 * 국면 배지 줄. 걸리는 규칙이 없으면 **아무것도 그리지 않는다.**
 *
 * 매크로 탭과 홈이 같은 것을 쓴다 — 두 벌로 두면 언젠가 한쪽만 고쳐져서 같은 상황을
 * 놓고 화면 둘이 다르게 말한다.
 *
 * 비었을 때 무슨 말을 할지는 부르는 쪽이 정한다. 매크로 탭에서는 "눈에 띄는 국면이
 * 없다"고 적어야 하지만(그 화면은 국면을 보러 온 곳이다), 홈에서는 그 한 줄이 종목 표를
 * 밀어내는 값만큼의 값어치가 없다.
 *
 * **합쳐서 점수 하나로 만들지 않는다.** 규칙 하나가 배지 하나라야 이유가 그대로 보인다
 * (`services/regime.py`).
 */
export function RegimeBadges({ badges }: { badges: MacroBadge[] }) {
  if (badges.length === 0) return null
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
