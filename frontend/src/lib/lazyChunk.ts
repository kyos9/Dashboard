import { lazy, type ComponentType, type LazyExoticComponent } from 'react'

const RELOADED = 'chunk-reloaded'

/**
 * 나중에 받는 화면 조각(차트 등)을 불러온다. 못 받으면 **한 번만** 새로고침한다.
 *
 * 조각 파일 이름에는 내용 해시가 붙는다(ChartModal-a1b2.js). 앱을 켜둔 채로 서버가
 * 업데이트되면, 열려 있는 옛 화면은 이제 서버에 없는 옛 이름을 찾는다 — 그대로 두면
 * 차트를 누르는 순간 화면 전체가 하얗게 빈다. 새로고침하면 새 index.html이 새 이름을
 * 가리키므로 해결된다. 새로고침한 뒤에도 실패하면(서버가 꺼졌다거나) 무한 반복하지 않게
 * 표시를 남겨두고 오류를 그대로 올린다.
 */
export function loadChunk<T>(load: () => Promise<T>): Promise<T> {
  return load().then(
    (module) => {
      forget()
      return module
    },
    (error: unknown) => {
      if (!alreadyReloaded()) {
        remember()
        window.location.reload()
        return new Promise<T>(() => {}) // 새로고침이 끝날 때까지 기다린다
      }
      throw error
    },
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 어떤 props의 화면이든 받는다
type AnyComponent = ComponentType<any>

/** `lazy` + `loadChunk` — 이름 붙은 내보내기(export function X)를 그대로 쓸 수 있게. */
export function lazyChunk<M extends Record<K, AnyComponent>, K extends keyof M>(
  load: () => Promise<M>,
  name: K,
): LazyExoticComponent<M[K]> {
  return lazy(() => loadChunk(load).then((module) => ({ default: module[name] })))
}

function alreadyReloaded(): boolean {
  try {
    return sessionStorage.getItem(RELOADED) === '1'
  } catch {
    return true // 저장소를 못 쓰면 반복을 막을 수 없으니 새로고침하지 않는다
  }
}

function remember() {
  try {
    sessionStorage.setItem(RELOADED, '1')
  } catch {
    // alreadyReloaded가 이미 true를 돌려주는 경우라 여기 올 일은 거의 없다
  }
}

function forget() {
  try {
    sessionStorage.removeItem(RELOADED)
  } catch {
    // 지우지 못해도 다음 실패 때 한 번 덜 새로고침할 뿐이다
  }
}
