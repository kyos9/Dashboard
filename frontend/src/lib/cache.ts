import { useLayoutEffect, useRef, useState, type DependencyList } from 'react'

/**
 * 화면끼리 나누는 작은 캐시 — 탭을 옮겨도 화면이 비지 않게 (ROADMAP 8-1).
 *
 * 탭에 들어오면 **들고 있던 값을 바로 그리고, 뒤에서 새로 받아 바꾼다.** 이전에는 탭을
 * 옮길 때마다 "불러오는 중…"으로 비었다가 다시 받았다 — 응답이 0.4초면 탭마다 0.4초 빈 화면.
 *
 * 규칙 셋:
 * - **고치면 비운다.** 무엇을 저장했으면(`notifyDataChanged`) 통째로 비운다. 방금 지운
 *   종목이 다른 탭에서 한 순간이라도 다시 보이면 "지웠는데 왜 있지?"가 된다.
 * - **사람이 바뀌면 비운다.** 캐시는 사람을 넘지 않는다. 앞사람의 포트폴리오가 뒷사람에게
 *   한 프레임이라도 보이면 서버의 사용자 격리(4단계)가 화면에서 샌다.
 * - **비우기 전에 떠난 요청은 담지 않는다.** 비운 뒤에 도착한 옛 응답이 캐시를 다시 채우면
 *   위 두 규칙이 뚫린다. 그래서 비울 때마다 세대를 올리고, 요청은 떠날 때의 세대를 들고 간다.
 */

interface Entry {
  value: unknown
  at: number
}

const store = new Map<string, Entry>()
let generation = 0
let owner: string | null = null
let lastLoaded: number | null = null
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

export function peekCache<T>(key: string): T | undefined {
  return store.get(key)?.value as T | undefined
}

/** 떠날 때 받은 세대(`cacheGeneration()`)가 지금과 다르면 담지 않는다. */
export function putCache(key: string, value: unknown, gen: number): boolean {
  if (gen !== generation) return false
  const at = Date.now()
  store.set(key, { value, at })
  lastLoaded = at
  emit()
  return true
}

export function cacheGeneration(): number {
  return generation
}

export function clearCache(): void {
  store.clear()
  generation += 1
  emit()
}

/**
 * 지금 화면을 쓰는 사람. 바뀌면 캐시를 비운다 — 로그인·나가기·세션 만료·다른 계정.
 * 받은 시각도 지운다 ("3분 전 받음"이 앞사람의 것이면 안 된다).
 */
export function setCacheOwner(next: string | null): void {
  if (next === owner) return
  owner = next
  lastLoaded = null
  clearCache()
}

/** 서버에서 마지막으로 무엇이든 받은 시각. 아직 없으면 null. */
export function lastLoadedAt(): number | null {
  return lastLoaded
}

/**
 * 마지막으로 받은 때를 사람 말로 — "방금 받음", "3분 전 받음", "2시간 전 받음".
 * 아직 받은 것이 없으면 null (그 자리에 다른 말을 쓴다).
 */
export function loadedAgoLabel(at: number | null, now: number): string | null {
  if (at === null) return null
  const minutes = Math.floor(Math.max(0, now - at) / 60_000)
  if (minutes < 1) return '방금 받음'
  if (minutes < 60) return `${minutes}분 전 받음`
  return `${Math.floor(minutes / 60)}시간 전 받음`
}

export function subscribeCache(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * 들고 있던 값을 먼저 그리고, 새로 받아 다시 그린다.
 *
 * - 들고 있던 값이 있으면 **그리기 전에**(`useLayoutEffect`) `apply` 한다 — 빈 화면이 한
 *   프레임도 나오지 않는다.
 * - 이미 무엇이든 그린 뒤에 다시 받을 때(저장 직후·앱으로 돌아왔을 때)는 `loading` 을 켜지
 *   않는다. 보던 표가 "불러오는 중…"으로 바뀌었다 돌아오면 보던 자리를 잃는다.
 * - 화면이 닫혔거나 다시 받기로 바뀐 뒤 도착한 응답은 그리지 않는다.
 *
 * `loading` 은 "그릴 것이 아직 하나도 없다"는 뜻이다.
 */
export function useCachedLoad<T>(
  key: string,
  load: () => Promise<T>,
  apply: (value: T) => void,
  onError: (error: unknown) => void,
  deps: DependencyList,
): { loading: boolean } {
  // 처음엔 늘 true — 들고 있던 값이 있어도 그리기 전에 아래에서 끈다. 값 없이 "비어 있음"
  // 화면이 한 번이라도 그려지면 그 안의 자식이 제 일을 시작해 버린다.
  const [loading, setLoading] = useState(true)
  const shown = useRef(false)
  // 매번 새로 만들어지는 함수를 의존성에 넣으면 그릴 때마다 다시 받는다 — 최신 것만 들고 있는다
  const latest = useRef({ load, apply, onError })
  useLayoutEffect(() => {
    latest.current = { load, apply, onError }
  })

  useLayoutEffect(() => {
    let alive = true
    const hit = store.get(key)
    if (hit !== undefined) {
      latest.current.apply(hit.value as T)
      shown.current = true
      setLoading(false)
    } else if (!shown.current) {
      setLoading(true)
    }
    const gen = cacheGeneration()
    latest.current
      .load()
      .then((value) => {
        putCache(key, value, gen)
        if (!alive) return
        latest.current.apply(value)
        shown.current = true
      })
      .catch((error: unknown) => {
        if (alive) latest.current.onError(error)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 부르는 쪽이 정한 deps 로 다시 받는다
  }, [key, ...deps])

  return { loading }
}
