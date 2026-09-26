import { useState } from 'react'
import { api } from '../api/client'
import {
  AI_PROVIDERS,
  clearAi,
  maskKey,
  providerLabel,
  saveAiSettings,
  useAiSettings,
} from '../lib/aiKey'
import type { AiModel, AiProviderName } from '../types'
import { ErrorNotice } from './ErrorNotice'

/**
 * AI 키 넣기 — 제공자 고르기 → 키 붙여넣기 → "키 확인"(모델 목록을 받아 키가 맞는지 본다)
 * → 모델 고르기 → 저장. 헤더의 "AI" 팝업과 차트 팝업의 "AI 정리" 탭이 같이 쓴다.
 *
 * **모델을 코드에 박지 않는다.** 그 키로 쓸 수 있는 모델을 제공자에게 물어 고르게 한다
 * (서버 `providers/ai.py` 참고).
 */
export function AiKeyForm({ account, onSaved }: { account: string; onSaved?: () => void }) {
  const saved = useAiSettings(account)
  const [provider, setProvider] = useState<AiProviderName>(saved?.provider ?? 'anthropic')
  const [keyInput, setKeyInput] = useState('')
  const [models, setModels] = useState<AiModel[] | null>(null)
  // 목록을 어느 키로 받았나 — 새 키를 넣고 확인 없이 저장하지 않게
  const [checkedKey, setCheckedKey] = useState<string | null>(null)
  const [model, setModel] = useState(saved?.model ?? '')
  const [remember, setRemember] = useState(saved?.remember ?? true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const savedForProvider = saved && saved.provider === provider ? saved : null
  const key = keyInput.trim() || savedForProvider?.key || ''
  const info = AI_PROVIDERS.find((p) => p.name === provider)!
  const trusted = key !== '' && (checkedKey === key || savedForProvider?.key === key)
  const canSave = trusted && model !== '' && !busy

  function pickProvider(next: AiProviderName) {
    setProvider(next)
    setModels(null)
    setCheckedKey(null)
    setModel(saved && saved.provider === next ? saved.model : '')
    setError(null)
    setNotice(null)
  }

  async function check() {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const found = (await api.aiModels(provider, key)).models
      if (found.length === 0) {
        setError('키는 맞지만 이 키로 쓸 수 있는 글쓰기 모델이 없습니다. 제공자 사이트에서 권한을 확인하세요.')
        return
      }
      setModels(found)
      setCheckedKey(key)
      setModel((current) => (found.some((m) => m.id === current) ? current : found[0].id))
      setNotice(`키가 맞습니다. 모델 ${found.length}개를 쓸 수 있습니다.`)
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }

  function save() {
    saveAiSettings({ provider, key, model, remember, account })
    setKeyInput('')
    setNotice('저장했습니다.')
    onSaved?.()
  }

  function forget() {
    clearAi()
    setKeyInput('')
    setModels(null)
    setCheckedKey(null)
    setModel('')
    setNotice('이 기기에서 키를 지웠습니다.')
  }

  return (
    <div className="ai-key-form">
      {saved && (
        <p className="ai-saved">
          저장된 키: <b>{providerLabel(saved.provider)}</b> <span className="mono">{maskKey(saved.key)}</span> ·
          모델 <span className="mono">{saved.model}</span>
          {!saved.remember && ' · 이 탭을 닫으면 지워짐'}
        </p>
      )}

      <div className="form-grid ai-key-grid">
        <label>
          <span>AI 회사</span>
          <select value={provider} onChange={(e) => pickProvider(e.target.value as AiProviderName)}>
            {AI_PROVIDERS.map((p) => (
              <option key={p.name} value={p.name}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>
            API 키{' '}
            <a href={info.keyUrl} target="_blank" rel="noreferrer noopener" className="hint">
              키 만들기 ↗
            </a>
          </span>
          <input
            type="password"
            value={keyInput}
            onChange={(e) => {
              setKeyInput(e.target.value)
              setNotice(null)
            }}
            placeholder={savedForProvider ? `저장됨 ${maskKey(savedForProvider.key)}` : info.placeholder}
            autoComplete="off"
            spellCheck={false}
          />
          {savedForProvider && <span className="hint">새 키로 바꿀 때만 넣으세요.</span>}
        </label>
      </div>

      <div className="ai-key-actions">
        <button onClick={() => void check()} disabled={busy || key === ''}>
          {busy ? '확인 중…' : '키 확인'}
        </button>
        {models ? (
          <div className="ai-model-pick">
            <label>
              <span>모델</span>
              <select value={model} onChange={(e) => setModel(e.target.value)}>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            {/* 선택칸 안의 글자는 줄을 못 바꾼다 — 긴 모델 이름은 여기서 줄을 바꿔 다 보여준다 */}
            <span className="hint mono ai-model-id">{model}</span>
          </div>
        ) : (
          savedForProvider && (
            <span className="hint">모델을 바꾸려면 "키 확인"으로 목록을 불러오세요.</span>
          )
        )}
      </div>

      <label className="check-line">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        이 기기에 기억 (끄면 이 탭을 닫을 때 지워집니다 — 공용 PC 라면 끄세요)
      </label>

      <div className="ai-key-actions">
        <button className="primary" onClick={save} disabled={!canSave}>
          저장
        </button>
        {saved && (
          <button className="ghost" onClick={forget}>
            키 지우기
          </button>
        )}
      </div>

      <ErrorNotice error={error} onDismiss={() => setError(null)} />
      {notice && <p className="ok-text">{notice}</p>}

      <ul className="hint ai-key-notes">
        <li>
          키는 <b>이 기기의 브라우저에만</b> 저장됩니다. 정리를 요청할 때만 서버를 거쳐 AI 회사로 전달되고,
          서버는 키를 저장하지도 기록하지도 않습니다. 다른 기기에서는 한 번 더 넣어야 합니다.
        </li>
        <li>
          사용료는 이 키의 계정에 청구됩니다. 제공자 사이트에서 <b>월 사용 한도</b>를 걸어 두면 안전합니다.
        </li>
      </ul>
    </div>
  )
}
