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

interface FakeWindow {
  url: string
  focus: ReturnType<typeof vi.fn>
  navigate: ReturnType<typeof vi.fn>
}

interface Harness {
  listeners: Record<string, ((event: unknown) => void)[]>
  caches: Map<string, FakeCache>
  fetch: ReturnType<typeof vi.fn>
  skipWaiting: ReturnType<typeof vi.fn>
  claim: ReturnType<typeof vi.fn>
  showNotification: ReturnType<typeof vi.fn>
  subscribe: ReturnType<typeof vi.fn>
  openWindow: ReturnType<typeof vi.fn>
  /** 지금 열려 있는 앱 창들 (clients.matchAll 이 돌려준다) */
  windows: FakeWindow[]
}

function load(): Harness {
  const listeners: Harness['listeners'] = {}
  const store = new Map<string, FakeCache>()

  const skipWaiting = vi.fn(async () => {})
  const claim = vi.fn(async () => {})
  const showNotification = vi.fn(async () => {})
  const subscribe = vi.fn(async () => ({ toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/new' }) }))
  const openWindow = vi.fn(async () => null)
  const windows: FakeWindow[] = []

  const self = {
    location: { origin: ORIGIN },
    skipWaiting,
    registration: { showNotification, pushManager: { subscribe } },
    clients: { claim, openWindow, matchAll: vi.fn(async () => windows) },
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

  return {
    listeners, caches: store, fetch: fetchMock, skipWaiting, claim, showNotification, subscribe, openWindow, windows,
  }
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

/* ---------- 푸시 알림 ---------- */

interface WaitEvent {
  waits: Promise<unknown>[]
  waitUntil: (p: Promise<unknown>) => void
}

function waitEvent<T extends object>(extra: T): T & WaitEvent {
  const event = { ...extra, waits: [] as Promise<unknown>[] } as T & WaitEvent
  event.waitUntil = (p) => {
    event.waits.push(p)
  }
  return event
}

function pushEvent(payload: unknown) {
  return waitEvent({
    data:
      payload === undefined
        ? null
        : {
            json: () => {
              if (typeof payload === 'string') return JSON.parse(payload)
              return payload
            },
          },
  })
}

function clickEvent(data: unknown) {
  const close = vi.fn()
  return { event: waitEvent({ notification: { data, close } }), close }
}

describe('푸시 — 받으면 띄운다', () => {
  it('서버가 보낸 제목·내용·종류·열 주소로 띄운다', async () => {
    const event = pushEvent({ title: '매수 시그널', body: 'VOO, QQQ', url: '/', tag: 'daily' })
    dispatch(h, 'push', event)
    await Promise.all(event.waits)

    expect(h.showNotification).toHaveBeenCalledWith('매수 시그널', {
      body: 'VOO, QQQ',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: 'daily',
      renotify: true,
      data: { url: '/' },
    })
  })

  it.each([
    ['내용이 JSON 이 아니어도', '이건 JSON 아님'],
    ['내용이 비어 있어도', undefined],
    ['제목이 없어도', { body: '본문만' }],
  ])('%s 알림은 띄운다 — 안 띄우면 브라우저가 구독을 거둔다', async (_, payload) => {
    const event = pushEvent(payload)
    dispatch(h, 'push', event)
    await Promise.all(event.waits)
    expect(h.showNotification).toHaveBeenCalledTimes(1)
    expect(h.showNotification.mock.calls[0][0]).toBe('신호판')
  })

  it.each(['https://evil.example/', '//evil.example/x', 'javascript:alert(1)', 42])(
    '앱 밖 주소(%s)는 첫 화면으로 바꾼다',
    async (url) => {
      const event = pushEvent({ title: 't', url })
      dispatch(h, 'push', event)
      await Promise.all(event.waits)
      expect(h.showNotification.mock.calls[0][1].data).toEqual({ url: '/' })
    },
  )
})

describe('푸시 — 누르면 앱을 연다', () => {
  it('이미 열린 창이 있으면 그 창을 앞으로 가져와 그 화면으로 옮긴다', async () => {
    const win = { url: `${ORIGIN}/`, focus: vi.fn(async () => {}), navigate: vi.fn(async () => {}) }
    h.windows.push(win)
    const { event, close } = clickEvent({ url: '/rebalance' })
    dispatch(h, 'notificationclick', event)
    await Promise.all(event.waits)

    expect(close).toHaveBeenCalled()
    expect(win.focus).toHaveBeenCalled()
    expect(win.navigate).toHaveBeenCalledWith(`${ORIGIN}/rebalance`)
    expect(h.openWindow).not.toHaveBeenCalled()
  })

  it('이미 그 화면이면 옮기지 않는다 (다시 불러오지 않게)', async () => {
    const win = { url: `${ORIGIN}/rebalance`, focus: vi.fn(async () => {}), navigate: vi.fn(async () => {}) }
    h.windows.push(win)
    const { event } = clickEvent({ url: '/rebalance' })
    dispatch(h, 'notificationclick', event)
    await Promise.all(event.waits)
    expect(win.focus).toHaveBeenCalled()
    expect(win.navigate).not.toHaveBeenCalled()
  })

  it('열린 창이 없으면 새로 연다', async () => {
    const { event } = clickEvent({ url: '/' })
    dispatch(h, 'notificationclick', event)
    await Promise.all(event.waits)
    expect(h.openWindow).toHaveBeenCalledWith(`${ORIGIN}/`)
  })

  it('남의 사이트 창은 건드리지 않고, 주소가 이상하면 첫 화면을 연다', async () => {
    const other = { url: 'https://other.example/', focus: vi.fn(async () => {}), navigate: vi.fn(async () => {}) }
    h.windows.push(other)
    const { event } = clickEvent({ url: 'https://evil.example/' })
    dispatch(h, 'notificationclick', event)
    await Promise.all(event.waits)
    expect(other.focus).not.toHaveBeenCalled()
    expect(h.openWindow).toHaveBeenCalledWith(`${ORIGIN}/`)
  })
})

describe('푸시 — 브라우저가 구독을 바꾸면', () => {
  it('새 구독을 서버에 다시 적는다', async () => {
    const newSubscription = { toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/renewed' }) }
    h.fetch.mockResolvedValue({ ok: true })
    const event = waitEvent({ newSubscription })
    dispatch(h, 'pushsubscriptionchange', event)
    await Promise.all(event.waits)

    expect(h.fetch).toHaveBeenCalledWith('/api/push/subscriptions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: 'https://fcm.googleapis.com/fcm/send/renewed' }),
    })
  })

  it('새 구독이 안 왔으면 서버 키로 직접 다시 구독한다', async () => {
    h.fetch.mockImplementation(async (url: string) =>
      url === '/api/push/key' ? { ok: true, json: async () => ({ public_key: 'AQID' }) } : { ok: true },
    )
    const event = waitEvent({ newSubscription: null })
    dispatch(h, 'pushsubscriptionchange', event)
    await Promise.all(event.waits)

    const options = h.subscribe.mock.calls[0][0]
    expect(options.userVisibleOnly).toBe(true)
    expect([...options.applicationServerKey]).toEqual([1, 2, 3])
    expect(h.fetch).toHaveBeenLastCalledWith('/api/push/subscriptions', expect.objectContaining({ method: 'POST' }))
  })

  it('로그인이 풀려 있어도 넘어지지 않는다 — 다음에 화면을 열 때 맞춘다', async () => {
    h.fetch.mockResolvedValue({ ok: false })
    const event = waitEvent({ newSubscription: null })
    dispatch(h, 'pushsubscriptionchange', event)
    await expect(Promise.all(event.waits)).resolves.toBeDefined()
    expect(h.subscribe).not.toHaveBeenCalled()
  })
})
