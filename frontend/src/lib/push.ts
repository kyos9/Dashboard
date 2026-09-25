/** 푸시 알림 — 이 기기에서 켜고 끄기 (ROADMAP 6단계). 보내는 쪽은 서버(`services/alerts.py`).
 *
 * 켜는 일은 세 단계다: 브라우저에 알림 권한을 받고 → 서버 공개키로 구독을 만들고 →
 * 그 구독(푸시 서버 주소 + 이 기기의 열쇠)을 서버에 맡긴다.
 *
 * **기기는 켠 사람의 것이다.** 한 폰을 둘이 번갈아 쓰면, A가 켠 구독이 브라우저에 남은 채
 * B가 로그인할 수 있다. 그때 B의 화면이 그 구독을 자기 것으로 다시 보내면 A의 알림이 B의
 * 폰으로 가지 않는 대신 **B의 알림이 A가 켠 기기로 간다** — 켠 사람과 받는 사람이 달라진다.
 * 그래서 누가 켰는지 이 기기에 적어두고(`OWNER_KEY`), 다른 사람이면 맞추지 않고 거둔다.
 *
 * 여기 있는 것은 전부 **없어도 화면은 돌아가는** 기능이다. 알림이 안 돼도 대시보드는 뜬다.
 */
import { api } from '../api/client'
import type { PushSubscriptionInput } from '../types'
import { isIos, isStandalone } from './pwa'

/** 이 기기에서 알림을 켠 계정 */
const OWNER_KEY = 'signalboard.pushOwner'

export type PushSupport =
  | 'ok'
  | 'unsupported' // 브라우저가 못 한다
  | 'insecure' // https 가 아니다 (집 안 주소 http://192.168.…)
  | 'needs-install' // 아이폰·아이패드는 홈 화면 앱에서만

export type PushState = Exclude<PushSupport, 'ok'> | 'denied' | 'off' | 'on'

export function pushSupport(): PushSupport {
  if (typeof window === 'undefined') return 'unsupported'
  // 아이폰 사파리에는 설치 전엔 PushManager 자체가 없다 — "지원 안 됨"보다 "설치하면 됨"이 맞는 말이다
  if (isIos() && !isStandalone()) return 'needs-install'
  if (!window.isSecureContext) return 'insecure'
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return 'unsupported'
  }
  return 'ok'
}

function readOwner(): string | null {
  try {
    return localStorage.getItem(OWNER_KEY)
  } catch {
    return null
  }
}

function writeOwner(account: string | null): void {
  try {
    if (account === null) localStorage.removeItem(OWNER_KEY)
    else localStorage.setItem(OWNER_KEY, account)
  } catch {
    // 저장이 막힌 브라우저 — 이번 세션만 켜진다 (다음에 열 때 맞추지 않는다)
  }
}

async function registration(): Promise<ServiceWorkerRegistration> {
  // 화면은 다 뜬 뒤에야 서비스 워커를 붙인다(pwa.ts). 그 전에 누르면 여기서 붙인다
  const existing = await navigator.serviceWorker.getRegistration()
  if (!existing) await navigator.serviceWorker.register('/sw.js')
  return navigator.serviceWorker.ready
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration()
  return reg ? reg.pushManager.getSubscription() : null
}

export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4)
  const raw = atob(padded)
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

/** 구독이 지금 서버 키로 만든 것인가. 서버 키 파일이 바뀌면 옛 구독으로는 안 온다. */
function sameKey(sub: PushSubscription, key: Uint8Array): boolean {
  const own = sub.options?.applicationServerKey
  if (!own) return true // 알 수 없으면 믿는다 — 틀렸으면 서버가 보내다 지운다
  const bytes = new Uint8Array(own)
  return bytes.length === key.length && bytes.every((b, i) => b === key[i])
}

function asInput(sub: PushSubscription): PushSubscriptionInput {
  const json = sub.toJSON()
  return { endpoint: json.endpoint ?? sub.endpoint, keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' } }
}

/** 이 기기의 상태. */
export async function pushState(account: string): Promise<PushState> {
  const support = pushSupport()
  if (support !== 'ok') return support
  if (Notification.permission === 'denied') return 'denied'
  const sub = await currentSubscription()
  return sub && readOwner() === account ? 'on' : 'off'
}

/** 이 기기에서 켠다. 권한을 거절하면 던진다 (화면이 이유를 보여준다). */
export async function enablePush(account: string): Promise<void> {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error(
      permission === 'denied'
        ? '알림이 차단되었습니다. 브라우저의 사이트 설정에서 알림을 허용으로 바꿔 주세요.'
        : '알림 허용을 누르지 않아 켜지 않았습니다.',
    )
  }
  const reg = await registration()
  const key = base64UrlToBytes((await api.getPushKey()).public_key)
  let sub = await reg.pushManager.getSubscription()
  if (sub && !sameKey(sub, key)) {
    await sub.unsubscribe()
    sub = null
  }
  sub ??= await subscribeOrExplain(reg, key)
  await api.addPushSubscription(asInput(sub))
  writeOwner(account)
}

/** 브라우저가 등록을 거절하면 영어 원문("Registration failed - permission denied") 대신 할 일을 말한다. */
async function subscribeOrExplain(reg: ServiceWorkerRegistration, key: Uint8Array<ArrayBuffer>) {
  try {
    return await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
  } catch (err) {
    // DOMException 도 message 를 가진다 (일부 환경에서는 Error 를 상속하지 않는다)
    const raw = (err as { message?: unknown })?.message
    const reason = typeof raw === 'string' && raw ? raw : String(err)
    throw new Error(
      '이 브라우저가 알림 등록을 거절했습니다. 시크릿 창이거나 브라우저 설정에서 푸시 알림이 꺼져 있을 수 ' +
        `있습니다 — 일반 창의 크롬·사파리·엣지에서 다시 해 보세요. (${reason})`,
    )
  }
}

/** 이 기기에서 끈다 — 서버에서 지우고 브라우저 구독도 거둔다. */
export async function disablePush(): Promise<void> {
  if (pushSupport() !== 'ok') return writeOwner(null)
  const sub = await currentSubscription()
  if (sub) {
    try {
      await api.removePushSubscription(sub.endpoint)
    } catch {
      // 서버에 이미 없다(404) — 브라우저 쪽만 거두면 된다
    }
    await sub.unsubscribe()
  }
  writeOwner(null)
}

/** 서버에는 알리지 않고 이 기기에서만 거둔다 (탈퇴 뒤 — 서버 쪽은 이미 지워졌다). */
export async function forgetPushDevice(): Promise<void> {
  if (pushSupport() !== 'ok') return
  const sub = await currentSubscription()
  if (sub) await sub.unsubscribe()
  writeOwner(null)
}

/**
 * 화면이 열릴 때 한 번 — 켜 둔 기기가 서버와 맞는지 본다.
 *
 * - 켠 사람이 아니면: 맞추지 않고 거둔다 (위 설명).
 * - 서버 키가 바뀌었으면: 새 키로 다시 구독한다.
 * - 그 밖에는 같은 구독을 다시 보낸다 — 서버를 백업에서 되돌려 구독이 빠졌어도 다시 채워진다.
 *
 * 무엇이 실패해도 조용히 넘긴다. 알림 설정 창을 열면 상태가 보인다.
 */
export async function syncPush(account: string): Promise<void> {
  try {
    if (pushSupport() !== 'ok' || Notification.permission !== 'granted') return
    const sub = await currentSubscription()
    if (!sub) return
    const owner = readOwner()
    if (owner !== account) {
      if (owner !== null) {
        // 다른 사람이 켠 구독 — 그 사람 알림이 여기로 오지 않게 거둔다 (서버는 다음 발송 때 지운다)
        await sub.unsubscribe()
        writeOwner(null)
      }
      return
    }
    const key = base64UrlToBytes((await api.getPushKey()).public_key)
    let current = sub
    if (!sameKey(sub, key)) {
      await sub.unsubscribe()
      const reg = await registration()
      current = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
    }
    await api.addPushSubscription(asInput(current))
  } catch (err) {
    console.warn('[push] 알림 구독을 맞추지 못했습니다:', err)
  }
}

/** 로그인 계정을 기기 주인 표시로. 혼자 쓰는 서버(계정 없음)는 하나로 친다. */
export function pushAccount(user: { email: string | null } | null): string {
  return user?.email ?? 'local'
}
