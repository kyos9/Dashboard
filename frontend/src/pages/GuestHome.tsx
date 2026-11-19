import { GuestMacroList } from '../components/macro/GuestMacroList'
import { LoginPrompt } from '../components/LoginPrompt'

/**
 * 손님(로그인 전)의 첫 화면 — 디자인 4차 목업 15 ③ 나 "매크로 목록 먼저".
 *
 * 첫인상 정답은 "매크로는 볼 수 있고, 내 종목은 구글 로그인"이다. 맨 위에 매크로 탭과 같은 줄 셋과
 * "모두 보기", 그 아래에 로그인 안내를 둔다. 로그인하면 같은 자리가 내 포트폴리오로 바뀐다.
 * 기능 소개 셋(시그널 · 리밸런싱 · 매크로)은 한 줄로 줄였다 — 매크로는 바로 위에 보인다.
 */
export function GuestHome() {
  return (
    <>
      <GuestMacroList />
      <LoginPrompt
        title="로그인하면 내 포트폴리오를 볼 수 있습니다"
        lead="담은 종목의 매수, 매도 시그널과 리밸런싱을 봅니다."
        macroHint={false}
      />
    </>
  )
}
