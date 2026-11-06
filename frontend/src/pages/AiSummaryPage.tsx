import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { AiPanel } from '../components/AiPanel'
import { TITLES } from '../lib/aiTitles'
import { useAuth } from '../components/AuthGate'
import { Icon } from '../components/icons/Icon'
import { pushAccount } from '../lib/push'

/** 이 화면이 여는 AI 정리 — 매크로 정리는 매크로 화면의 창으로 남는다(묶음 5) */
const KINDS = ['portfolio', 'watchlist'] as const
type Kind = (typeof KINDS)[number]

const LEADS: Record<Kind, string> = {
  portfolio: '담은 종목의 비중과 수익률(%)만 AI 에 보냅니다. 금액은 보내지 않습니다.',
  watchlist: '담은 종목 전체의 신호와 지표를 AI 가 한 장으로 정리합니다.',
}

/**
 * AI 정리 화면 (디자인 4차 묶음 2, 목업 09) — 예전에는 창(팝업)이었다. 긴 글이라 화면 하나가 읽기 좋다(①㉠).
 * 홈의 "AI 포트폴리오 진단" 줄, 시그널 목록의 "AI 전체 정리" 줄에서 들어온다. ‹ 는 온 곳으로.
 */
export function AiSummaryPage() {
  const { kind: raw } = useParams()
  const navigate = useNavigate()
  const { user, canAdvise } = useAuth()
  const kind = KINDS.find((k) => k === raw)
  const location = useLocation()
  // 앱 안에서 왔으면 온 곳으로, 주소로 바로 열었으면(첫 칸) 홈으로 — 앱 밖으로 나가지 않는다 (묶음 2 검토 참고)
  const back = () => (location.key !== 'default' ? navigate(-1) : navigate('/'))

  if (!kind)
    return (
      <div className="empty-state">
        <h3>없는 화면입니다</h3>
      </div>
    )
  const { title, sub } = TITLES[kind]
  return (
    <div className="ai-page">
      <div className="sub-head">
        <button type="button" className="sub-back" onClick={back} aria-label="뒤로">
          <Icon name="back" size={22} />
        </button>
        <div>
          <h2>{title}</h2>
          <span className="hint">{sub}</span>
        </div>
      </div>
      <p className="ai-page-lead">{LEADS[kind]}</p>
      {kind === 'portfolio' && !canAdvise ? (
        <p className="callout">포트폴리오 진단은 관리자가 열어 둔 동안 쓸 수 있습니다.</p>
      ) : (
        <AiPanel target={{ kind }} account={pushAccount(user)} />
      )}
    </div>
  )
}
