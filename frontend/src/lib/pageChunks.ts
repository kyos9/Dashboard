import { lazyChunk, saveData } from './lazyChunk'

/**
 * 탭 화면 조각 (ROADMAP 8-5).
 *
 * 대시보드만 여는 사람이 리밸런싱·매크로·재무·종목 관리·방침 코드까지 기다릴 이유가 없다.
 * 첫 화면에는 대시보드(손님은 첫 화면)만 싣고, 나머지는 탭을 열 때 받는다.
 *
 * 다만 탭을 누를 때마다 받기 시작하면 8-1 에서 없앤 "누르고 빈 화면"이 돌아온다. 그래서
 * 첫 화면이 다 그려지고 한가해지면 **미리 받아 둔다** — 서비스 워커가 들고 있으므로 다음부터는
 * 네트워크 없이 뜨고, 오프라인에서도 탭이 열린다. 데이터 절약 모드면 미리 받지 않는다.
 *
 * 받는 함수는 조각마다 하나다. `import()` 는 같은 파일이면 같은 약속을 돌려주므로, 미리 받은
 * 것과 탭이 여는 것이 같은 모듈이다.
 */
const loaders = {
  rebalance: () => import('../pages/RebalancePanel'),
  macro: () => import('../pages/MacroPanel'),
  fundamentals: () => import('../pages/FundamentalsPage'),
  stocks: () => import('../pages/StockManager'),
  policy: () => import('../pages/Policy'),
}

export const RebalancePanel = lazyChunk(loaders.rebalance, 'RebalancePanel')
export const MacroPanel = lazyChunk(loaders.macro, 'MacroPanel')
export const FundamentalsPage = lazyChunk(loaders.fundamentals, 'FundamentalsPage')
export const StockManager = lazyChunk(loaders.stocks, 'StockManager')
export const Policy = lazyChunk(loaders.policy, 'Policy')

/**
 * 헤더·메뉴에서 여는 팝업 — 누를 때만 쓴다. 첫 화면에서 빼고 탭과 같이 미리 받는다.
 * (화면 설정은 첫 그림에 필요한 `prefs` 만 첫 화면에 남고 팝업 틀은 여기로 온다)
 */
const popupLoaders = {
  display: () => import('../components/DisplayModal'),
  push: () => import('../components/PushModal'),
  aiKey: () => import('../components/AiKeyModal'),
  diagnostics: () => import('../components/DiagnosticsModal'),
  users: () => import('../components/UsersModal'),
}

export const DisplayModal = lazyChunk(popupLoaders.display, 'DisplayModal')
export const PushModal = lazyChunk(popupLoaders.push, 'PushModal')
export const AiKeyModal = lazyChunk(popupLoaders.aiKey, 'AiKeyModal')
export const DiagnosticsModal = lazyChunk(popupLoaders.diagnostics, 'DiagnosticsModal')
export const UsersModal = lazyChunk(popupLoaders.users, 'UsersModal')

let preloaded = false

/**
 * 한가할 때 한 번만 받아 둔다. 못 받아도 조용히 넘어간다 — 탭을 열 때 다시 받는다.
 * 방침과 관리자 팝업(진단·사용자)은 드물게 열어서 미리 받지 않는다.
 */
export function preloadPages(): void {
  if (preloaded || saveData()) return
  preloaded = true
  const run = () => {
    const popups = [popupLoaders.display, popupLoaders.push, popupLoaders.aiKey]
    for (const load of [loaders.rebalance, loaders.macro, loaders.fundamentals, loaders.stocks, ...popups]) {
      void load().catch(() => {})
    }
  }
  const idle = (
    globalThis as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
    }
  ).requestIdleCallback
  if (idle) idle(run, { timeout: 4000 })
  else setTimeout(run, 1500)
}

/** 테스트용 */
export function resetPreload() {
  preloaded = false
}
