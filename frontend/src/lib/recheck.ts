import { useEffect } from 'react'

/**
 * `active`인 동안 `ms`마다 `recheck`를 부른다.
 *
 * 종목을 등록하면 시세는 서버가 뒤에서 받는다(서버에서 종목 하나에 10초 넘게 걸린다).
 * 그동안 화면이 멈춰 있지 않게 등록은 바로 끝내고, 여기서 끝났는지 몇 초마다 다시 묻는다.
 * `seen`은 마지막으로 받은 데이터다 — 새 데이터가 오면 다음 물음을 다시 건다.
 */
export function useRecheck(active: boolean, recheck: () => void, seen: unknown, ms = 3000) {
  useEffect(() => {
    if (!active) return
    const id = window.setTimeout(recheck, ms)
    return () => window.clearTimeout(id)
  }, [active, recheck, seen, ms])
}
