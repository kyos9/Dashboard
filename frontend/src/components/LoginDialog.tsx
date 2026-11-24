import { ModalOrPane } from './ui/ModalOrPane'
import { LoginButton } from './LoginPrompt'
import { POLICY_PATH } from '../lib/policy'

/**
 * 손님이 내 종목이 있어야 하는 일(종목 추가)에 손을 댔을 때 뜨는 로그인 창 — 디자인 5차 목업 09e ②.
 * 뒤 화면(빈 홈 · 빈 재무 · 빈 리밸런싱)은 그대로 두고 가운데에 띄운다.
 */
export function LoginDialog({ onClose }: { onClose: () => void }) {
  return (
    <ModalOrPane label="로그인" className="login-dialog" title="종목을 담으려면 로그인하세요" onClose={onClose}>
      <p className="login-dialog-lead">
        담은 종목은 내 계정에 저장되어 어느 기기에서든 봅니다. 승인받은 사람만 쓰며, 처음이면 승인을 기다립니다.
      </p>
      <LoginButton className="primary login-dialog-go" />
      <p className="hint consent-line">
        로그인하면 <a href={POLICY_PATH}>개인정보처리방침과 이용약관</a>에 동의하는 것으로 봅니다.
      </p>
    </ModalOrPane>
  )
}
