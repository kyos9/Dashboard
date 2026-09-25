/* 서비스 워커 — 폰에 설치해 앱처럼 쓰기 위한 최소한의 캐시.
 *
 * 규칙은 셋이고, 첫 번째가 가장 중요하다.
 *
 * 1. `/api/` 는 **손대지 않는다.** 시세·시그널·보유수량은 매 순간 달라지고, 로그인한
 *    사람에 따라 내용이 다르다. 한 번이라도 캐시하면 "어제 값이 오늘 값인 척" 하거나
 *    남의 화면이 남는다. 이 아래 fetch 처리에서 그냥 통과시킨다.
 * 2. 화면 이동(navigate)은 **네트워크 먼저**. 성공하면 그 답을 오프라인용으로 한 벌
 *    남긴다. 서버가 안 잡히면 남겨둔 것을 보여준다 — 껍데기는 뜨고 숫자만 비는 편이
 *    아무것도 안 뜨는 것보다 낫다.
 * 3. `/assets/` 는 **캐시 먼저**. 파일 이름에 내용 해시가 붙어 있어(app-a1b2c3.js)
 *    내용이 바뀌면 이름이 바뀐다 — 같은 이름이면 같은 파일이므로 영원히 캐시해도 된다.
 *
 * 새 버전은 2번 덕에 내려온다. 화면을 열 때마다 index.html 을 네트워크에서 먼저
 * 받으므로, 새 이름의 /assets/ 를 가리키게 되고 그건 캐시에 없으니 새로 받는다.
 * 그래서 이 파일 자체는 **캐시되면 안 된다** — 서버가 no-cache 로 내보낸다(app/web.py).
 *
 * 맨 아래는 푸시 알림이다 (ROADMAP 6단계). 서버가 보낸 것을 띄우고, 누르면 앱을 연다.
 */

const VERSION = 'v1'
const SHELL_CACHE = `signalboard-shell-${VERSION}`
const ASSET_CACHE = `signalboard-assets-${VERSION}`
const KEEP = [SHELL_CACHE, ASSET_CACHE]

// 오프라인일 때 돌려줄 껍데기. 어느 주소로 들어오든 같은 index.html 이므로 하나만 둔다.
const SHELL_KEY = '/index.html'

// 옛 빌드의 파일이 무한정 쌓이지 않게. 한 빌드가 쓰는 파일은 열 몇 개라, 이 정도면
// 최근 몇 판은 남는다 (뒤로 가기나 롤백 직후에도 캐시가 살아 있게).
const ASSET_LIMIT = 60

// 아이콘·manifest 처럼 이름에 해시가 없는 것들. 있으면 바로 쓰되 뒤에서 갱신한다.
const STATIC_PATHS = /^\/(manifest\.webmanifest|favicon\.svg|apple-touch-icon\.png|icon-[\w-]+\.png)$/

self.addEventListener('install', (event) => {
  // 설치 직후부터 오프라인이 되도록 껍데기를 한 벌 받아둔다. 실패해도 설치는 성공시킨다
  // — 여기서 넘어지면 서비스 워커가 아예 안 붙는다.
  event.waitUntil(
    (async () => {
      try {
        const res = await fetch('/', { cache: 'reload' })
        if (res && res.ok) {
          const cache = await caches.open(SHELL_CACHE)
          await cache.put(SHELL_KEY, res.clone())
        }
      } catch {
        // 설치 시점에 네트워크가 없을 수도 있다. 다음 접속 때 2번 규칙이 채운다.
      }
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(names.filter((n) => !KEEP.includes(n)).map((n) => caches.delete(n)))
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request

  // POST·DELETE 같은 것은 캐시할 수 없다. 남의 도메인도 손대지 않는다.
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  // 규칙 1 — API는 통과. respondWith 를 부르지 않으면 브라우저가 평소대로 처리한다.
  //
  // 아래 규칙들이 "이것만 캐시한다"는 목록이라 지금은 이 줄이 없어도 API는 안 걸린다.
  // 그래도 남겨둔다 — 언젠가 누가 "나머지도 캐시하자"를 덧붙이는 날, 이 줄이 마지막
  // 방어선이 된다. (src/test/sw.test.ts 가 그 상황을 실제로 만들어 확인한다.)
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return

  // 이 파일 자신은 브라우저가 직접 관리한다. 캐시에 끼면 새 버전이 영영 안 내려간다.
  if (url.pathname === '/sw.js') return

  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req))
    return
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(req))
    return
  }

  if (STATIC_PATHS.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(req))
  }
})

/** 규칙 2 — 네트워크 먼저, 안 되면 남겨둔 껍데기. */
async function networkFirst(request) {
  try {
    const res = await fetch(request)
    if (res && res.ok) {
      const cache = await caches.open(SHELL_CACHE)
      await cache.put(SHELL_KEY, res.clone())
    }
    return res
  } catch (err) {
    const cached = await caches.match(SHELL_KEY, { cacheName: SHELL_CACHE })
    if (cached) return cached
    throw err
  }
}

/** 규칙 3 — 이름이 같으면 같은 파일. */
async function cacheFirst(request) {
  const cache = await caches.open(ASSET_CACHE)
  const hit = await cache.match(request)
  if (hit) return hit

  const res = await fetch(request)
  if (res && res.ok) {
    await cache.put(request, res.clone())
    await trim(cache, ASSET_LIMIT)
  }
  return res
}

/** 있으면 바로 주고, 새것은 뒤에서 받아 다음 번에 쓴다. */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(ASSET_CACHE)
  const hit = await cache.match(request)

  const fetching = fetch(request).then(async (res) => {
    if (res && res.ok) {
      await cache.put(request, res.clone())
      await trim(cache, ASSET_LIMIT)
    }
    return res
  })

  if (hit) {
    // 갱신 실패는 조용히 넘긴다 — 지금 보여줄 것은 이미 손에 있다.
    fetching.catch(() => {})
    return hit
  }
  return fetching
}

/** 넣은 순서대로 오래된 것부터 버린다 (Cache API 는 넣은 순서를 지킨다). */
async function trim(cache, limit) {
  const keys = await cache.keys()
  if (keys.length <= limit) return
  await Promise.all(keys.slice(0, keys.length - limit).map((k) => cache.delete(k)))
}

/* ---------- 푸시 알림 ----------
 *
 * 서버(backend/app/services/alerts.py)가 `{title, body, url, tag}` 를 싸서 보낸다.
 *
 * **무엇이 오든 알림은 띄운다.** 브라우저는 "받으면 반드시 보여준다"는 약속으로 구독을
 * 내줬다(userVisibleOnly). 내용이 깨졌다고 조용히 넘기면 크롬은 대신 "백그라운드에서
 * 업데이트됨" 같은 알림을 띄우고, 그게 반복되면 구독을 거둬간다.
 */

const DEFAULT_TITLE = '신호판'

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    // 글자가 아니거나 JSON 이 아니다 — 기본 문구로 띄운다
  }
  const title = typeof data.title === 'string' && data.title ? data.title : DEFAULT_TITLE
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof data.body === 'string' ? data.body : '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      // 같은 종류는 앞의 것을 갈아끼운다 — 알림 서랍에 어제 것이 쌓이지 않게
      tag: typeof data.tag === 'string' && data.tag ? data.tag : 'signalboard',
      renotify: true,
      data: { url: safePath(data.url) },
    }),
  )
})

/** 이 앱 안의 주소만. `//evil.example` 이나 `https://…` 는 첫 화면으로 바꾼다. */
function safePath(url) {
  if (typeof url !== 'string' || !url.startsWith('/') || url.startsWith('//')) return '/'
  return url
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const path = safePath(event.notification.data && event.notification.data.url)
  event.waitUntil(
    (async () => {
      const target = new URL(path, self.location.origin).href
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      // 이미 열려 있으면 그 창을 앞으로 — 새 창을 자꾸 열면 탭이 쌓인다
      for (const client of windows) {
        if (new URL(client.url).origin !== self.location.origin) continue
        await client.focus()
        if (client.url !== target && 'navigate' in client) {
          try {
            await client.navigate(target)
          } catch {
            // 이 서비스 워커가 맡지 않은 창은 옮길 수 없다 — 앞으로 가져온 것으로 충분하다
          }
        }
        return
      }
      await self.clients.openWindow(target)
    })(),
  )
})

/* 브라우저가 구독을 스스로 바꿨을 때 (만료·키 교체). 새 구독을 서버에 알려두지 않으면
 * 알림이 그날로 끊기는데, 사용자는 알 방법이 없다. 로그인 쿠키가 살아 있으면 여기서
 * 바로 다시 적고, 아니면 다음에 앱을 열 때 화면이 맞춘다 (src/lib/push.ts). */
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      try {
        let sub = event.newSubscription
        if (!sub) {
          const res = await fetch('/api/push/key')
          if (!res.ok) return
          const { public_key: key } = await res.json()
          sub = await self.registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: base64UrlToBytes(key),
          })
        }
        await fetch('/api/push/subscriptions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(sub.toJSON()),
        })
      } catch {
        // 다음에 화면을 열 때 다시 맞춘다
      }
    })(),
  )
})

function base64UrlToBytes(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4)
  const raw = atob(padded)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}
