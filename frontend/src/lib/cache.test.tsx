import { act, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../api/client'
import {
  cacheGeneration,
  clearCache,
  lastLoadedAt,
  loadedAgoLabel,
  peekCache,
  putCache,
  setCacheOwner,
  useCachedLoad,
} from './cache'

/** 끝을 밖에서 정하는 약속 — "아직 안 왔다"를 그대로 붙잡아 둘 수 있다 */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('캐시 한 칸', () => {
  it('담은 값을 돌려주고, 비우면 없다', () => {
    putCache('a', [1, 2], cacheGeneration())
    expect(peekCache('a')).toEqual([1, 2])
    clearCache()
    expect(peekCache('a')).toBeUndefined()
  })

  it('비우기 전에 떠난 요청의 응답은 담지 않는다 — 고치기 전 값이 되살아나지 않게', () => {
    const before = cacheGeneration()
    clearCache()
    expect(putCache('a', 'old', before)).toBe(false)
    expect(peekCache('a')).toBeUndefined()
  })

  it('쓰는 사람이 바뀌면 비우고, 받은 시각도 지운다', () => {
    setCacheOwner('a@b.c')
    putCache('page', 'A의 포트폴리오', cacheGeneration())
    expect(lastLoadedAt()).not.toBeNull()

    setCacheOwner('x@y.z')
    expect(peekCache('page')).toBeUndefined()
    expect(lastLoadedAt()).toBeNull()
  })

  it('같은 사람이면 그대로 둔다', () => {
    setCacheOwner('a@b.c')
    putCache('page', 'mine', cacheGeneration())
    setCacheOwner('a@b.c')
    expect(peekCache('page')).toBe('mine')
  })

  it('손님으로 돌아가도 비운다', () => {
    setCacheOwner('a@b.c')
    putCache('page', 'mine', cacheGeneration())
    setCacheOwner('guest')
    expect(peekCache('page')).toBeUndefined()
  })
})

describe('받은 때를 사람 말로', () => {
  const t0 = 1_000_000_000
  it.each([
    [null, null],
    [t0, '방금 받음'],
    [t0 - 59_000, '방금 받음'],
    [t0 - 60_000, '1분 전 받음'],
    [t0 - 59 * 60_000, '59분 전 받음'],
    [t0 - 60 * 60_000, '1시간 전 받음'],
    [t0 - 5 * 3600_000, '5시간 전 받음'],
  ])('%s → %s', (at, label) => {
    expect(loadedAgoLabel(at, t0)).toBe(label)
  })
})

/** 화면 흉내 — 받은 값을 그리고, 비어 있으면 "불러오는 중" */
function Screen({ load, dep = 0 }: { load: () => Promise<string>; dep?: number }) {
  const [value, setValue] = useState<string | null>(null)
  const [error, setError] = useState<unknown>(null)
  const { loading } = useCachedLoad('page:test', load, setValue, setError, [dep])
  if (loading) return <p>불러오는 중…</p>
  return (
    <>
      <p>{`값: ${value}`}</p>
      {error !== null && <p>오류</p>}
    </>
  )
}

describe('들고 있던 값을 먼저 그린다', () => {
  beforeEach(() => clearCache())

  it('처음에는 받을 때까지 "불러오는 중", 받으면 그린다', async () => {
    render(<Screen load={() => Promise.resolve('첫 값')} />)
    expect(screen.getByText('불러오는 중…')).toBeInTheDocument()
    expect(await screen.findByText('값: 첫 값')).toBeInTheDocument()
  })

  it('다시 열면 새 응답이 오기 전에 들고 있던 값이 보인다 — 빈 화면이 없다', async () => {
    const first = render(<Screen load={() => Promise.resolve('어제 값')} />)
    await screen.findByText('값: 어제 값')
    first.unmount()

    const next = deferred<string>()
    render(<Screen load={() => next.promise} />)
    // 응답은 아직이다
    expect(screen.getByText('값: 어제 값')).toBeInTheDocument()
    expect(screen.queryByText('불러오는 중…')).not.toBeInTheDocument()

    await act(async () => next.resolve('오늘 값'))
    expect(screen.getByText('값: 오늘 값')).toBeInTheDocument()
  })

  it('보던 화면을 다시 받을 때 "불러오는 중"으로 바꾸지 않는다', async () => {
    const view = render(<Screen load={() => Promise.resolve('처음')} dep={0} />)
    await screen.findByText('값: 처음')

    clearCache() // 저장한 뒤와 같다 — 캐시가 비었다
    const next = deferred<string>()
    view.rerender(<Screen load={() => next.promise} dep={1} />)
    expect(screen.getByText('값: 처음')).toBeInTheDocument()
    expect(screen.queryByText('불러오는 중…')).not.toBeInTheDocument()

    await act(async () => next.resolve('저장 뒤'))
    expect(screen.getByText('값: 저장 뒤')).toBeInTheDocument()
  })

  it('비운 뒤에는 다시 열어도 옛 값을 보이지 않는다', async () => {
    const first = render(<Screen load={() => Promise.resolve('지우기 전')} />)
    await screen.findByText('값: 지우기 전')
    first.unmount()
    clearCache()

    render(<Screen load={() => new Promise<string>(() => {})} />)
    expect(screen.getByText('불러오는 중…')).toBeInTheDocument()
    expect(screen.queryByText('값: 지우기 전')).not.toBeInTheDocument()
  })

  it('떠나는 중에 캐시를 비웠으면 늦게 온 응답은 담지 않는다', async () => {
    const late = deferred<string>()
    render(<Screen load={() => late.promise} />)
    clearCache() // 예: 그 사이에 나갔다
    await act(async () => late.resolve('앞사람 값'))
    expect(peekCache('page:test')).toBeUndefined()
  })

  it('다시 받기가 실패하면 보던 값은 두고 오류를 알린다', async () => {
    const view = render(<Screen load={() => Promise.resolve('보던 값')} dep={0} />)
    await screen.findByText('값: 보던 값')
    view.rerender(<Screen load={() => Promise.reject(new Error('끊김'))} dep={1} />)
    expect(await screen.findByText('오류')).toBeInTheDocument()
    expect(screen.getByText('값: 보던 값')).toBeInTheDocument()
  })

  it('닫힌 화면에는 늦게 온 응답을 그리지 않는다', async () => {
    const late = deferred<string>()
    const apply = vi.fn()
    function Closing() {
      useCachedLoad('page:closing', () => late.promise, apply, () => {}, [])
      return null
    }
    const view = render(<Closing />)
    view.unmount()
    await act(async () => late.resolve('늦은 값'))
    expect(apply).not.toHaveBeenCalled()
    // 캐시에는 담는다 — 다음에 열 때 쓴다
    expect(peekCache('page:closing')).toBe('늦은 값')
  })
})

describe('쓰기 요청은 화면 캐시를 비운다 (api/client.ts)', () => {
  const ok = (body: unknown = {}) =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })

  beforeEach(() => putCache('page:dashboard', '저장 전', cacheGeneration()))
  afterEach(() => vi.restoreAllMocks())

  it('읽기는 그대로 둔다', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok([]))
    await api.listStocks()
    expect(peekCache('page:dashboard')).toBe('저장 전')
  })

  it('저장하면 비운다', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok({ ticker: 'VOO' }))
    await api.updateStock('VOO', { target_weight_pct: 10 })
    expect(peekCache('page:dashboard')).toBeUndefined()
  })

  it('실패해도 비운다 — 여러 건 중 일부만 저장됐을 수 있다', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"detail":"안 됨"}', { status: 400 }))
    await expect(api.updateStockOrder(['VOO'])).rejects.toThrow()
    expect(peekCache('page:dashboard')).toBeUndefined()
  })

  it('값을 바꾸지 않는 POST(AI 모델 목록·시험 알림)는 그대로 둔다', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok({ sent: 1, failed: 0 }))
    await api.sendTestPush()
    expect(peekCache('page:dashboard')).toBe('저장 전')
  })

  it('응답을 받은 뒤에 비운다 — 그 사이 떠난 읽기가 옛 값을 새 세대로 담지 않게', async () => {
    const pending = deferred<Response>()
    vi.spyOn(globalThis, 'fetch').mockReturnValue(pending.promise)
    const saving = api.purgeStock('VOO')
    const genWhileSaving = cacheGeneration()
    pending.resolve(new Response(null, { status: 204 }))
    await saving
    // 저장 중에 떠난 읽기는 이 세대를 들고 있다 — 이제 담기지 않는다
    expect(putCache('page:dashboard', '저장 전 읽은 값', genWhileSaving)).toBe(false)
    await waitFor(() => expect(peekCache('page:dashboard')).toBeUndefined())
  })
})
