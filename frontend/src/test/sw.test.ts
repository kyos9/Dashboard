/**
 * `public/sw.js` 의 규칙이 지켜지는지 본다.
 *
 * 이 파일은 번들에 들어가지 않고 브라우저가 따로 받아 가므로, 평소처럼 import 할 수가
 * 없다. 그래서 **실제로 배포되는 그 파일을 읽어** 가짜 브라우저 환경에서 실행시키고,
 * 가짜 요청을 던져 어떻게 행동하는지 본다. 복사본을 테스트하면 복사본만 옳아진다.
 *
 * 가장 중요한 것은 첫 번째 테스트다. `/api/` 가 한 번이라도 캐시되면 어제 시세가
 * 오늘 시세인 척하거나, 로그아웃한 뒤에도 남의 화면이 남는다. 그리고 그 증상은
 * "가끔 숫자가 이상하다"로 나타나 원인을 찾기 대단히 어렵다.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
// `?raw` 는 파일을 글자 그대로 읽어온다. 배포되는 바로 그 파일이어야 뜻이 있다.
import SW_SOURCE from '../../public/sw.js?raw'

const ORIGIN = 'https://signal.example.com'

interface FakeResponse {
  ok: boolean
  body: string
  clone: () => FakeResponse
}

function response(body: string, ok = true): FakeResponse {
  const res: FakeResponse = { ok, body, clone: () => response(body, ok) }
  return res
}

/** Cache API 흉내. 넣은 순서를 지킨다 (실제 명세도 그렇고, 정리 로직이 그걸 믿는다). */
class FakeCache {
  entries = new Map<string, FakeResponse>()

  private key(request: { url: string } | string) {
    return typeof request === 'string' ? new URL(request, ORIGIN).href : request.url
  }

  async match(request: { url: string } | string) {
    return this.entries.get(this.key(request))
  }

  async put(request: { url: string } | string, res: FakeResponse) {
    this.entries.set(this.key(request), res)
  }

  async delete(request: { url: string } | string) {
    return this.entries.delete(this.key(request))
  }

  async keys() {
    return [...this.entries.keys()].map((url) => ({ url }))
  }
}

interface Harness {
  listeners: Record<string, ((event: unknown) => void)[]>
  caches: Map<string, FakeCache>
  fetch: ReturnType<typeof vi.fn>
  skipWaiting: ReturnType<typeof vi.fn>
  claim: ReturnType<typeof vi.fn>
}

function load(): Harness {
  const listeners: Harness['listeners'] = {}
  const store = new Map<string, FakeCache>()

  const skipWaiting = vi.fn(async () => {})
  const claim = vi.fn(async () => {})

  const self = {
    location: { origin: ORIGIN },
    skipWaiting,
    clients: { claim },
    addEventListener(type: string, fn: (event: unknown) => void) {
      ;(listeners[type] ??= []).push(fn)
    },
  }

  const caches = {
    async open(name: string) {
      let cache = store.get(name)
      if (!cache) store.set(name, (cache = new FakeCache()))
      return cache
    },
    async keys() {
      return [...store.keys()]
    },
    async delete(name: string) {
      return store.delete(name)
    },
    async match(request: { url: string } | string, options?: { cacheName?: string }) {
      const cache = store.get(options?.cacheName ?? '')
      return cache?.match(request)
    },
  }

  const fetchMock = vi.fn(async () => response('네트워크'))

  // 배포되는 파일을 그대로 실행한다. self/caches/fetch 만 가짜로 갈아끼운다.
  new Function('self', 'caches', 'fetch', 'console', SW_SOURCE)(self, caches, fetchMock, console)

  return { listeners, caches: store, fetch: fetchMock, skipWaiting, claim }
}

interface FetchEvent {
  request: { url: string; method: string; mode: string }
  responded?: Promise<FakeResponse>
  waits: Promise<unknown>[]
  respondWith: (p: Promise<FakeResponse>) => void
  waitUntil: (p: Promise<unknown>) => void
}

function fetchEvent(path: string, init: { method?: string; mode?: string } = {}): FetchEvent {
  const event: FetchEvent = {
    request: {
      url: path.startsWith('http') ? path : `${ORIGIN}${path}`,
      method: init.method ?? 'GET',
      mode: init.mode ?? 'no-cors',
    },
    waits: [],
    respondWith(p) {
      event.responded = p
    },
    waitUntil(p) {
      event.waits.push(p)
    },
  }
  return event
}

function dispatch(h: Harness, type: string, event: unknown) {
  for (const fn of h.listeners[type] ?? []) fn(event)
}

/** 어느 캐시에든 들어간 주소를 전부 모은다. */
function everythingCached(h: Harness): string[] {
  return [...h.caches.values()].flatMap((cache) => [...cache.entries.keys()])
}

let h: Harness

beforeEach(() => {
  h = load()
})

describe('API는 건드리지 않는다', () => {
  it.each(['/api/dashboard', '/api/stocks/VOO/refresh', '/api'])(
    '%s 는 서비스 워커가 가로채지 않는다',
    (path) => {
      const event = fetchEvent(path)
      dispatch(h, 'fetch', event)
      // respondWith 를 부르지 않으면 브라우저가 평소대로 네트워크로 보낸다
      expect(event.responded).toBeUndefined()
    },
  )

  it('API를 여러 번 불러도 캐시에 아무것도 남지 않는다', async () => {
    for (const path of ['/api/dashboard', '/api/rebalance/current', '/api/logs']) {
      dispatch(h, 'fetch', fetchEvent(path))
    }
    expect(everythingCached(h)).toEqual([])
  })
})

describe('가로채지 않는 나머지', () => {
  it('GET이 아닌 요청', () => {
    const event = fetchEvent('/assets/app.js', { method: 'POST' })
    dispatch(h, 'fetch', event)
    expect(event.responded).toBeUndefined()
  })

  it('남의 도메인', () => {
    const event = fetchEvent('https://query1.finance.yahoo.com/v8/chart/VOO')
    dispatch(h, 'fetch', event)
    expect(event.responded).toBeUndefined()
  })

  it('서비스 워커 자기 자신 — 캐시에 끼면 새 버전이 영영 안 내려간다', () => {
    const event = fetchEvent('/sw.js')
    dispatch(h, 'fetch', event)
    expect(event.responded).toBeUndefined()
  })

  it('규칙에 없는 정적 파일은 그냥 둔다', () => {
    const event = fetchEvent('/robots.txt')
    dispatch(h, 'fetch', event)
    expect(event.responded).toBeUndefined()
  })
})

describe('화면 이동 — 네트워크 먼저', () => {
  it('네트워크가 되면 그 답을 주고 오프라인용으로 남긴다', async () => {
    h.fetch.mockResolvedValue(response('<html>새 화면</html>'))
    const event = fetchEvent('/rebalance', { mode: 'navigate' })
    dispatch(h, 'fetch', event)

    expect((await event.responded!).body).toBe('<html>새 화면</html>')
    expect(everythingCached(h)).toEqual([`${ORIGIN}/index.html`])
  })

  it('서버가 안 잡히면 남겨둔 화면을 보여준다', async () => {
    h.fetch.mockResolvedValue(response('<html>저장된 화면</html>'))
    dispatch(h, 'fetch', fetchEvent('/', { mode: 'navigate' }))
    await Promise.resolve()
    await Promise.resolve()

    h.fetch.mockRejectedValue(new Error('offline'))
    const offline = fetchEvent('/history', { mode: 'navigate' })
    dispatch(h, 'fetch', offline)
    expect((await offline.responded!).body).toBe('<html>저장된 화면</html>')
  })

  it('남겨둔 것도 없으면 평소처럼 오류가 난다 — 빈 화면을 지어내지 않는다', async () => {
    h.fetch.mockRejectedValue(new Error('offline'))
    const event = fetchEvent('/', { mode: 'navigate' })
    dispatch(h, 'fetch', event)
    await expect(event.responded).rejects.toThrow('offline')
  })

  it('서버가 500을 내면 그 답을 그대로 주되 저장하지는 않는다', async () => {
    h.fetch.mockResolvedValue(response('서버 오류', false))
    const event = fetchEvent('/', { mode: 'navigate' })
    dispatch(h, 'fetch', event)

    expect((await event.responded!).body).toBe('서버 오류')
    expect(everythingCached(h)).toEqual([])
  })
})

describe('/assets — 캐시 먼저', () => {
  it('두 번째부터는 네트워크에 가지 않는다 (이름에 해시가 있어 같은 이름이면 같은 파일)', async () => {
    h.fetch.mockResolvedValue(response('console.log(1)'))

    const first = fetchEvent('/assets/app-a1b2c3.js')
    dispatch(h, 'fetch', first)
    expect((await first.responded!).body).toBe('console.log(1)')
    expect(h.fetch).toHaveBeenCalledTimes(1)

    const second = fetchEvent('/assets/app-a1b2c3.js')
    dispatch(h, 'fetch', second)
    expect((await second.responded!).body).toBe('console.log(1)')
    expect(h.fetch).toHaveBeenCalledTimes(1)
  })

  it('이름이 다르면 새로 받는다 — 그래서 새 버전이 내려온다', async () => {
    h.fetch.mockResolvedValue(response('옛것'))
    const old = fetchEvent('/assets/app-a1b2c3.js')
    dispatch(h, 'fetch', old)
    await old.responded

    h.fetch.mockResolvedValue(response('새것'))
    const fresh = fetchEvent('/assets/app-d4e5f6.js')
    dispatch(h, 'fetch', fresh)
    expect((await fresh.responded!).body).toBe('새것')
  })

  it('옛 빌드의 파일이 무한정 쌓이지 않는다', async () => {
    h.fetch.mockResolvedValue(response('x'))
    for (let i = 0; i < 65; i += 1) {
      const event = fetchEvent(`/assets/chunk-${i}.js`)
      dispatch(h, 'fetch', event)
      await event.responded
    }
    const cached = everythingCached(h)
    expect(cached).toHaveLength(60)
    // 오래된 것부터 버린다
    expect(cached).not.toContain(`${ORIGIN}/assets/chunk-0.js`)
    expect(cached).toContain(`${ORIGIN}/assets/chunk-64.js`)
  })
})

describe('아이콘·manifest — 있으면 바로 주고 뒤에서 갱신', () => {
  it.each(['/manifest.webmanifest', '/favicon.svg', '/apple-touch-icon.png', '/icon-192.png'])(
    '%s 를 캐시한다',
    async (path) => {
      h.fetch.mockResolvedValue(response('내용'))
      const event = fetchEvent(path)
      dispatch(h, 'fetch', event)
      expect((await event.responded!).body).toBe('내용')
      expect(everythingCached(h)).toEqual([`${ORIGIN}${path}`])
    },
  )

  it('두 번째는 캐시를 바로 주면서도 새것을 받아둔다', async () => {
    h.fetch.mockResolvedValue(response('예전 아이콘'))
    const first = fetchEvent('/icon-192.png')
    dispatch(h, 'fetch', first)
    await first.responded

    h.fetch.mockResolvedValue(response('새 아이콘'))
    const second = fetchEvent('/icon-192.png')
    dispatch(h, 'fetch', second)
    expect((await second.responded!).body).toBe('예전 아이콘')

    // 뒤에서 받아둔 것은 다음 번에 나온다
    await new Promise((r) => setTimeout(r, 0))
    const third = fetchEvent('/icon-192.png')
    dispatch(h, 'fetch', third)
    expect((await third.responded!).body).toBe('새 아이콘')
  })
})

describe('설치와 정리', () => {
  it('설치하면서 껍데기를 한 벌 받아둔다', async () => {
    h.fetch.mockResolvedValue(response('<html>껍데기</html>'))
    const event = { waits: [] as Promise<unknown>[], waitUntil(p: Promise<unknown>) { this.waits.push(p) } }
    dispatch(h, 'install', event)
    await Promise.all(event.waits)

    expect(everythingCached(h)).toEqual([`${ORIGIN}/index.html`])
    expect(h.skipWaiting).toHaveBeenCalled()
  })

  it('설치 시점에 네트워크가 없어도 설치는 끝난다 — 여기서 넘어지면 아예 안 붙는다', async () => {
    h.fetch.mockRejectedValue(new Error('offline'))
    const event = { waits: [] as Promise<unknown>[], waitUntil(p: Promise<unknown>) { this.waits.push(p) } }
    dispatch(h, 'install', event)
    await expect(Promise.all(event.waits)).resolves.toBeDefined()
    expect(h.skipWaiting).toHaveBeenCalled()
  })

  it('예전 버전이 쓰던 캐시는 지우고 지금 것만 남긴다', async () => {
    h.caches.set('signalboard-shell-v0', new FakeCache())
    h.caches.set('남이-쓰는-캐시', new FakeCache())
    h.fetch.mockResolvedValue(response('<html/>'))
    const install = { waits: [] as Promise<unknown>[], waitUntil(p: Promise<unknown>) { this.waits.push(p) } }
    dispatch(h, 'install', install)
    await Promise.all(install.waits)

    const activate = { waits: [] as Promise<unknown>[], waitUntil(p: Promise<unknown>) { this.waits.push(p) } }
    dispatch(h, 'activate', activate)
    await Promise.all(activate.waits)

    expect([...h.caches.keys()]).not.toContain('signalboard-shell-v0')
    expect([...h.caches.keys()]).not.toContain('남이-쓰는-캐시')
    expect(h.claim).toHaveBeenCalled()
  })
})
