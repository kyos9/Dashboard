/** 알림 설정 창의 문구 — 종류 이름과, 켤 수 없는 기기에 할 일 (components/PushModal.tsx). */
import type { PushKind } from '../types'
import type { PushState } from './push'

export const KIND_TEXT: Record<PushKind, { label: string; hint: string }> = {
  buy: { label: '매수 시그널', hint: '담은 종목에 새로 떴을 때' },
  band: { label: '비중조절', hint: '목표 비중에서 밴드만큼 벗어났을 때' },
  review: { label: '포트폴리오 리뷰', hint: '리뷰할 날이 됐을 때' },
  signup: { label: '가입 신청', hint: '누가 가입을 신청했을 때 (관리자)' },
}

/** 이 기기가 왜 켤 수 없는지 — 할 일을 같이 적는다. */
export const STATE_TEXT: Record<Exclude<PushState, 'on' | 'off'>, string> = {
  'needs-install':
    '아이폰·아이패드는 홈 화면에 추가한 앱에서만 알림을 받을 수 있습니다 (iOS 16.4 이상). ' +
    '사파리 공유 버튼 → "홈 화면에 추가" → 그 아이콘으로 열어서 여기서 켜 주세요.',
  insecure: '알림은 https 주소로 들어왔을 때만 켤 수 있습니다. 서버 도메인 주소로 열어 주세요.',
  unsupported: '이 브라우저는 알림을 지원하지 않습니다. 크롬·사파리·엣지·파이어폭스에서 열어 주세요.',
  denied:
    '이 사이트의 알림이 차단되어 있습니다. 브라우저의 사이트 설정 → 알림에서 "허용"으로 바꾼 뒤 이 창을 다시 열어 주세요.',
}
