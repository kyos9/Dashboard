import { useEffect, useRef } from 'react'

/**
 * 폰의 뒤로가기로 팝업을 닫는다 (ROADMAP 6단계).
 *
 * 팝업은 주소가 없어서, 그냥 두면 뒤로가기가 팝업 뒤의 **탭을 이전 탭으로** 넘긴다. 폰에서는
 * 뒤로가기가 "닫기"라서, 차트를 보다 뒤로가기를 누르면 보던 탭까지 잃는다.
 *
 * 그래서 팝업이 열릴 때 같은 주소로 기록을 한 칸 쌓고(`pushState`), 뒤로가기가 그 칸을 빼면
 * 팝업을 닫는다. ✕·Esc·바깥으로 닫았으면 쌓은 칸을 대신 빼 준다 — 안 빼면 다음 뒤로가기가
 * 아무 일도 안 하는 칸이 남는다.
 *
 * - **칸에는 몇 번째 팝업인지 적는다.** 사용자 목록 위에 확인 창이 뜬 것처럼 겹쳐 있으면
 *   뒤로가기 한 번에 맨 위 하나만 닫힌다.
 * - **라우터의 기록은 그대로 둔다.** 칸을 쌓을 때 지금 기록(`idx`·`key`)을 복사해 두므로
 *   라우터는 같은 화면으로 돌아온 것으로 본다.
 * - **팝업이 닫히는 사이 다른 기록이 쌓였으면 건드리지 않는다.** 칸을 빼는 일은 한 박자 뒤에
 *   하고, 그때 맨 위가 우리 칸일 때만 뺀다. 그래야 닫자마자 다른 화면으로 가도 되돌리지 않는다.
 *   같은 박자에 다시 열리면(개발 모드의 StrictMode 가 그렇다) 뺄 칸을 그대로 다시 쓴다.
 *   칸을 빼는 도중에 열렸으면 뺀 다음 다시 쌓는다 — 그 뒤로가기를 새 팝업이 받으면 곧바로 닫힌다.
 */

const KEY = '__modal'

/** 지금 열려 있는 팝업 수 */
let open = 0
let settleTimer: ReturnType<typeof setTimeout> | undefined
/** 닫힌 팝업의 칸을 빼는 중 — 이번 popstate 는 사람이 누른 뒤로가기가 아니다 */
let settling = false
let listening = false

function level(state: unknown): number {
  const value = (state as Record<string, unknown> | null)?.[KEY]
  return typeof value === 'number' ? value : 0
}

function mark(n: number) {
  window.history.pushState({ ...(window.history.state ?? {}), [KEY]: n }, '')
}

/** 닫힌 팝업의 칸을 뺀다 — 열린 팝업 수보다 높이 쌓인 만큼. */
function settle() {
  settleTimer = undefined
  const extra = level(window.history.state) - open
  if (extra <= 0) return
  settling = true
  window.history.go(-extra)
}

/**
 * 칸을 빼는 사이에 새 팝업이 열렸으면(✕ 로 닫고 곧바로 다른 팝업) 그 팝업의 칸이 같이
 * 빠졌다 — 다시 쌓는다. 팝업마다 다는 리스너보다 **먼저** 돌아야 하므로 처음 한 번만 단다.
 */
function afterSettle() {
  if (!settling) return
  settling = false
  for (let n = level(window.history.state) + 1; n <= open; n++) mark(n)
}

/**
 * @param onClose 뒤로가기로 닫을 때 부른다
 * @param canClose 거짓이면 뒤로가기를 눌러도 닫지 않는다 (지우는 중인 확인 창)
 */
export function useBackToClose(onClose: () => void, canClose = true) {
  const latest = useRef({ onClose, canClose })
  useEffect(() => {
    latest.current = { onClose, canClose }
  })

  useEffect(() => {
    if (!listening) {
      window.addEventListener('popstate', afterSettle)
      listening = true
    }
    const mine = ++open
    // 같은 박자에 닫혔다 다시 열린 경우 — 아직 안 뺀 칸이 있으면 그것을 쓴다
    if (level(window.history.state) < mine) mark(mine)

    const onPop = () => {
      // 이벤트가 아니라 지금 기록을 본다 — afterSettle 이 칸을 다시 쌓았을 수 있다
      if (level(window.history.state) >= mine) return // 내 위의 팝업이 닫혔다
      if (!latest.current.canClose) {
        mark(mine) // 지금은 닫을 수 없다 — 빠진 칸을 다시 쌓는다
        return
      }
      latest.current.onClose()
    }
    window.addEventListener('popstate', onPop)

    return () => {
      window.removeEventListener('popstate', onPop)
      open--
      settleTimer ??= setTimeout(settle, 0)
    }
  }, [])
}

/** 테스트용 — 모듈 상태를 처음으로 */
export function resetBackToClose() {
  open = 0
  if (settleTimer !== undefined) clearTimeout(settleTimer)
  settleTimer = undefined
  settling = false
}
