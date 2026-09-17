import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { ErrorNotice } from './ErrorNotice'
import type { LogsResponse } from '../types'

/**
 * 진단 — 서버가 남긴 기록 중 **잘못된 것만** 본다.
 *
 * 전체 로그를 그대로 쏟으면 대부분이 "정상 동작 기록"이라 스크롤하다 안 읽게 된다.
 * 실제로 알고 싶은 건 "어제 VOO 시세를 왜 못 받았나" 한 줄이다. 그래서 기본은 경고
 * 이상만 보여주고, 전체가 필요하면 파일을 받게 한다.
 *
 * 예전에는 이 내용이 검은 콘솔 창으로 흘러가고 사라졌다. 창을 닫는 순간(그리고 서버에
 * 올린 뒤에는 애초에) 볼 방법이 없었다.
 */

const LEVEL_CLASS: Record<string, string> = {
  CRITICAL: 'badge-red',
  ERROR: 'badge-red',
  WARNING: 'badge-amber',
}

function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}

export function summarize(logs: LogsResponse | null): string {
  if (!logs) return ''
  if (!logs.available) return '아직 기록된 로그가 없습니다'
  const bad = (logs.counts.ERROR ?? 0) + (logs.counts.CRITICAL ?? 0)
  const warn = logs.counts.WARNING ?? 0
  if (bad === 0 && warn === 0) return '최근 기록에 경고·오류가 없습니다'
  return `최근 기록에 오류 ${bad}건 · 경고 ${warn}건`
}

export function DiagnosticsModal({ onClose }: { onClose: () => void }) {
  const [level, setLevel] = useState<'warning' | 'all'>('warning')
  const [logs, setLogs] = useState<LogsResponse | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    api
      .getLogs(level)
      .then(setLogs)
      .catch(setError)
      .finally(() => setLoading(false))
  }, [level])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [onClose])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal diag-modal"
        role="dialog"
        aria-modal="true"
        aria-label="진단"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div className="modal-title">
            <h3>진단</h3>
            <span className="hint">{summarize(logs)}</span>
          </div>
          <div className="chip-row">
            <button
              className={`chip${level === 'warning' ? ' active' : ''}`}
              onClick={() => setLevel('warning')}
            >
              경고·오류만
            </button>
            <button
              className={`chip${level === 'all' ? ' active' : ''}`}
              onClick={() => setLevel('all')}
            >
              전체
            </button>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </div>

        <ErrorNotice error={error} onDismiss={() => setError(null)} />

        <div className="diag-body">
          {loading && <p className="hint">불러오는 중…</p>}
          {!loading && logs?.available === false && (
            <p className="hint">서버를 켜고 잠시 쓰면 여기에 쌓입니다.</p>
          )}
          {!loading && logs?.available && logs.entries.length === 0 && (
            <p className="hint">
              {level === 'warning'
                ? '걸러낼 것이 없습니다 — 전체를 누르면 정상 기록까지 볼 수 있습니다.'
                : '보여줄 기록이 없습니다.'}
            </p>
          )}
          {logs?.entries.map((entry, i) => (
            <div className="diag-row" key={`${entry.time}-${i}`}>
              <span className={`badge ${LEVEL_CLASS[entry.level] ?? 'badge-grey'}`}>
                {entry.level}
              </span>
              <span className="mono hint diag-time">{entry.time}</span>
              <div className="diag-text">
                <span className="hint">{entry.logger}</span>
                <pre>{entry.message}</pre>
              </div>
            </div>
          ))}
        </div>

        <div className="diag-foot">
          <span className="hint mono">
            {logs?.available
              ? `${logs.path} · ${sizeText(logs.size_bytes)}`
              : ''}
          </span>
          {/* fetch로 받아 Blob을 만들 이유가 없다 — 브라우저가 직접 내려받게 둔다 */}
          <a className="diag-download" href={api.logsDownloadUrl()} download>
            로그 파일 받기
          </a>
        </div>
      </div>
    </div>
  )
}
