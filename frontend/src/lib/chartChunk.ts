import { lazyChunk, saveData } from './lazyChunk'

/**
 * 종목 차트 팝업 조각 — 대시보드·재무 화면이 같이 쓴다.
 *
 * 차트 코드(lightweight-charts)는 번들의 3분의 1이라 첫 화면에 싣지 않는다. 대신 첫 화면이
 * 다 그려지고 한가해지면 **미리 받아 둔다** (ROADMAP 8-1). 전에는 이름을 누른 뒤에야 받기
 * 시작해서, 받는 동안 아무 반응이 없다가 팝업이 한 번에 떴다.
 */
const load = () => import('../components/ChartModal')

export const ChartModal = lazyChunk(load, 'ChartModal')

let preloaded = false

/** 한가할 때 한 번만 받아 둔다. 못 받아도 조용히 넘어간다 — 누를 때 다시 받는다.
 * 데이터 절약 모드면 미리 받지 않는다(탭 조각과 같은 규칙). */
export function preloadChartModal(): void {
  if (preloaded || saveData()) return
  preloaded = true
  const run = () => void load().catch(() => {})
  const idle = (globalThis as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback
  if (idle) idle(run)
  else setTimeout(run, 1500)
}
