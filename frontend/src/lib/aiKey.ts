/**
 * AI 키와 받아 둔 정리 글 — **이 기기의 브라우저에만** 둔다 (ROADMAP 3c, 8-1).
 *
 * 서버에 두지 않기로 한 대가로 기기마다 한 번씩 넣어야 한다. 대신 서버가 털려도 키는 없다.
 *
 * - "이 기기에 기억"을 켜면 localStorage(브라우저를 닫아도 남음), 끄면 sessionStorage(탭을
 *   닫으면 사라짐). 공용 PC 에서는 끄고 쓰라고 화면에 적는다.
 * - **누구의 키인지 같이 적는다.** 같은 기기에서 다른 계정으로 들어오면 앞사람의 키를 쓰면
 *   안 된다 — 남의 잔액으로 정리를 받게 된다. 계정이 다르면 없는 것으로 본다.
 * - 나가기·탈퇴 때 지운다 (`AuthGate`).
 */
import { useEffect, useState } from 'react'
import type { AiAnalysis, AiProviderName } from '../types'

const KEY_STORE = 'signalboard:ai-key'
const RESULT_STORE = 'signalboard:ai-results'
/** 같은 탭의 다른 화면(헤더의 키 설정 ↔ 팝업의 AI 탭)이 바뀐 것을 알게 */
const CHANGED = 'signalboard:ai-changed'
/** 받아 둔 정리 글은 종목 몇 개까지만 (오래된 것부터 버린다) */
const MAX_RESULTS = 20

export interface AiProviderInfo {
  name: AiProviderName
  label: string
  /** 키를 만드는 곳 */
  keyUrl: string
  placeholder: string
}

export const AI_PROVIDERS: AiProviderInfo[] = [
  {
    name: 'anthropic',
    label: 'Claude (Anthropic)',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    placeholder: 'sk-ant-…',
  },
  {
    name: 'openai',
    label: 'ChatGPT (OpenAI)',
    keyUrl: 'https://platform.openai.com/api-keys',
    placeholder: 'sk-…',
  },
  {
    name: 'gemini',
    label: 'Gemini (Google)',
    keyUrl: 'https://aistudio.google.com/apikey',
    placeholder: 'AIza…',
  },
]

export function providerLabel(name: AiProviderName): string {
  return AI_PROVIDERS.find((p) => p.name === name)?.label ?? name
}

export interface AiSettings {
  provider: AiProviderName
  key: string
  model: string
  /** 브라우저를 닫아도 남길까 */
  remember: boolean
  /** 누가 넣었나 (`pushAccount` 와 같은 값) */
  account: string
}

function stores(): Storage[] {
  const out: Storage[] = []
  try {
    out.push(localStorage)
  } catch {
    // 저장이 막힌 브라우저
  }
  try {
    out.push(sessionStorage)
  } catch {
    // 저장이 막힌 브라우저
  }
  return out
}

function readJson<T>(storage: Storage, name: string): T | null {
  try {
    const raw = storage.getItem(name)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function announce() {
  window.dispatchEvent(new Event(CHANGED))
}

/** 이 계정이 이 기기에 넣어 둔 키. 없거나 다른 계정 것이면 null. */
export function readAiSettings(account: string): AiSettings | null {
  for (const storage of stores()) {
    const found = readJson<AiSettings>(storage, KEY_STORE)
    if (found && found.key && found.provider && found.model && found.account === account) return found
  }
  return null
}

export function saveAiSettings(settings: AiSettings): void {
  for (const storage of stores()) {
    try {
      storage.removeItem(KEY_STORE)
    } catch {
      // 무시
    }
  }
  try {
    const target = settings.remember ? localStorage : sessionStorage
    target.setItem(KEY_STORE, JSON.stringify(settings))
  } catch {
    // 저장이 막힌 브라우저 — 이번 화면에서만 쓴다 (다시 열면 다시 넣어야 한다)
  }
  announce()
}

/** 키와 받아 둔 글을 모두 지운다 — 키 지우기, 나가기, 탈퇴 */
export function clearAi(): void {
  for (const storage of stores()) {
    try {
      storage.removeItem(KEY_STORE)
      storage.removeItem(RESULT_STORE)
    } catch {
      // 무시
    }
  }
  announce()
}

/** 끝 네 자리만 — 어느 키를 넣었는지 알아볼 만큼만 보여준다 */
export function maskKey(key: string): string {
  return key.length <= 4 ? '…' : `…${key.slice(-4)}`
}

/** 이 계정의 키를 구독한다. 다른 화면에서 저장하거나 지우면 따라 바뀐다. */
export function useAiSettings(account: string): AiSettings | null {
  const [settings, setSettings] = useState<AiSettings | null>(() => readAiSettings(account))
  useEffect(() => {
    const sync = () => setSettings(readAiSettings(account))
    sync()
    window.addEventListener(CHANGED, sync)
    // 다른 탭에서 바꾼 것 (localStorage 만 알려준다)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(CHANGED, sync)
      window.removeEventListener('storage', sync)
    }
  }, [account])
  return settings
}

// --- 받아 둔 정리 글 --------------------------------------------------------
// 다시 열 때마다 돈을 내고 새로 받지 않게, 마지막 글을 종목마다 하나씩 둔다.

interface ResultStore {
  account: string
  items: Record<string, AiAnalysis>
}

export function readAiResult(account: string, ticker: string): AiAnalysis | null {
  try {
    const found = readJson<ResultStore>(localStorage, RESULT_STORE)
    if (!found || found.account !== account) return null
    return found.items[ticker] ?? null
  } catch {
    return null
  }
}

export function saveAiResult(account: string, result: AiAnalysis): void {
  try {
    const found = readJson<ResultStore>(localStorage, RESULT_STORE)
    const items = found && found.account === account ? { ...found.items } : {}
    delete items[result.ticker]
    items[result.ticker] = result
    const kept = Object.entries(items).slice(-MAX_RESULTS)
    localStorage.setItem(RESULT_STORE, JSON.stringify({ account, items: Object.fromEntries(kept) }))
  } catch {
    // 저장이 막혔거나 가득 찼다 — 이번에만 보인다
  }
}
