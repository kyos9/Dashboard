import { useState } from 'react'
import { AddStockDialog } from './AddStockDialog'
import { LoginDialog } from '../LoginDialog'
import tfSeedling from '../../assets/tossface/u1F331.svg'

interface Props {
  /** 손님 — 종목 추가 단추가 종목 추가 창 대신 로그인 창을 연다 (목업 09e ②) */
  guest?: boolean
  /** 재무 · 리밸런싱의 빈 화면은 제목만 바꾼다 */
  title?: string
  onAdded?: () => void
  onError?: (error: unknown) => void
}

const NO_OWNED = new Set<string>()
const noop = () => {}

/**
 * PC 의 빈 화면 (종목 0개, 그리고 손님) — 디자인 5차 목업 09e. 폰 모양 좁은 안내가 가운데 떠 있던 것을 넓은 상자 하나로:
 * 새싹 그림 · 제목 · 세 단계(가로 셋) · 종목 추가 단추 하나(주인: "공란일 때는 가운데 하나만").
 * 들어온 사람은 PC 홈과 같은 종목 추가 창, 손님은 로그인 창이 뜬다 — 손님도 진짜 화면 틀을 보고, 손을 댈 때 로그인한다.
 */
export function DesktopFirstSteps({ guest = false, title = '종목을 담으면 시작합니다', onAdded = noop, onError = noop }: Props) {
  const [adding, setAdding] = useState(false)
  return (
    <section className="first-steps-pc" aria-labelledby="first-steps-title">
      <img className="first-steps-face" src={tfSeedling} alt="" width={64} height={64} />
      <h3 id="first-steps-title">{title}</h3>
      <p>담은 종목마다 매수, 매도 신호와 비중을 보여 줍니다.</p>
      <ol className="first-steps-row" role="list">
        <li>
          <b>종목 담기</b>
          <span>이름이나 코드로 찾습니다. 시세는 알아서 받습니다.</span>
        </li>
        <li>
          <b>보유수량 적기</b>
          <span>수량과 목표 비중을 적으면 비중이 얼마나 벗어났는지 봅니다.</span>
        </li>
        <li>
          <b>홈에서 보기</b>
          <span>평가금액, 수익률, 오늘 뜬 신호가 여기에 나옵니다.</span>
        </li>
      </ol>
      <button type="button" className="primary first-steps-go" onClick={() => setAdding(true)} aria-haspopup="dialog">
        종목 추가
      </button>
      {/* 폰의 같은 글(pages/Dashboard.tsx)은 서버 한도와 같은지 테스트가 본다 — 숫자를 바꾸면 둘 다 */}
      <p className="hint">종목은 30개까지 담을 수 있습니다.</p>
      {adding &&
        (guest ? (
          <LoginDialog onClose={() => setAdding(false)} />
        ) : (
          <AddStockDialog owned={NO_OWNED} onClose={() => setAdding(false)} onAdded={onAdded} onError={onError} />
        ))}
    </section>
  )
}
