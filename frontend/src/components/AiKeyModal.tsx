import { ModalOrPane } from './ui/ModalOrPane'
import { AiKeyForm } from './AiKeyForm'

/**
 * 헤더의 "AI" — 내 AI 키 넣기·바꾸기·지우기 (ROADMAP 3c).
 *
 * 분석은 대시보드 맨 오른쪽 버튼·종목 팝업의 "AI 분석" 탭에서 받는다. 여기는 키만 다룬다.
 */
export function AiKeyModal({ account, onClose, inline = false }: { account: string; onClose: () => void; inline?: boolean }) {

  return (
    <ModalOrPane
      inline={inline}
      label="AI 키 설정"
      className="ai-key-modal"
      title="AI 키"
      sub={<span className="hint">시그널 목록, 종목 화면의 &ldquo;AI 분석&rdquo;과 AI 정리 화면에 씁니다</span>}
      onClose={onClose}
    >
        <AiKeyForm account={account} />
    </ModalOrPane>
  )
}
