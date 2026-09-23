import { MacroStrip } from '../components/MacroStrip'
import { LoginPrompt } from '../components/LoginPrompt'

/**
 * 손님(로그인 전)의 첫 화면.
 *
 * 대시보드와 같은 자리에 매크로 한 줄을 그대로 두고, 종목 표 자리에 "무엇을 하는 도구인지"와
 * 로그인 버튼을 둔다. 로그인하면 같은 자리가 내 종목으로 바뀐다 — 화면이 어디로 튀지 않는다.
 */
export function GuestHome() {
  return (
    <>
      <MacroStrip />
      <LoginPrompt title="로그인하면 내 포트폴리오를 볼 수 있습니다">
        <ul className="guest-features">
          <li>
            <b>매수·매도 시그널</b> — 담은 종목마다 기술적 타이밍 시그널과 이번 기간 매수
            일정을 보여줍니다.
          </li>
          <li>
            <b>리밸런싱</b> — 목표 비중에서 얼마나 벗어났는지, 언제 조정할지 알려줍니다.
          </li>
          <li>
            <b>매크로</b> — 금리·물가·공포지수 같은 국면 지표.
          </li>
        </ul>
      </LoginPrompt>
    </>
  )
}
