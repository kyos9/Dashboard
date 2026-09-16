import { useEffect, useId, useRef, useState } from 'react'
import { api } from '../api/client'
import { MARKET_LABEL } from '../lib/display'
import type { SymbolMatch } from '../types'

const DEBOUNCE_MS = 250

const BOARD_LABEL: Record<string, string> = {
  KOSPI: '코스피',
  KOSDAQ: '코스닥',
  KONEX: '코넥스',
}

function describeMatch(match: SymbolMatch): string {
  if (match.board) return BOARD_LABEL[match.board] ?? match.board
  return MARKET_LABEL[match.market] ?? match.market
}

interface Props {
  /** 확정된 선택. null이면 아직 고르지 않은 상태 */
  selected: SymbolMatch | null
  onSelect: (match: SymbolMatch | null) => void
  /** 후보를 고르지 않고 엔터를 쳤을 때 (입력값 그대로 서버에 맡긴다) */
  onSubmitRaw: (typed: string) => void
  disabled?: boolean
}

/**
 * 종목명·코드·티커로 검색해서 고르는 입력.
 *
 * 서버가 임의로 하나를 고르지 않고 후보를 보여주는 이유: 종목코드를 잘못 짚으면 다른
 * 회사의 시세를 받아오는데, 그건 "못 찾았다"보다 나쁘다. 그래서 사용자가 눈으로
 * 확인하고 고르게 한다.
 */
export function SymbolSearch({ selected, onSelect, onSubmitRaw, disabled }: Props) {
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<SymbolMatch[]>([])
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const [searching, setSearching] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const listId = useId()

  // 검색어가 바뀌면 잠깐 기다렸다가 조회한다 (타이핑마다 요청하지 않도록)
  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < 1 || selected) {
      setMatches([])
      setSearching(false)
      return
    }

    let cancelled = false
    setSearching(true)
    const timer = setTimeout(() => {
      api
        .searchSymbols(trimmed)
        .then((rows) => {
          if (cancelled) return
          setMatches(rows)
          setHighlight(0)
          setOpen(rows.length > 0)
        })
        .catch(() => {
          if (!cancelled) setMatches([])
        })
        .finally(() => {
          if (!cancelled) setSearching(false)
        })
    }, DEBOUNCE_MS)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query, selected])

  // 바깥을 클릭하면 후보 목록을 닫는다
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const choose = (match: SymbolMatch) => {
    onSelect(match)
    setQuery('')
    setMatches([])
    setOpen(false)
  }

  const clear = () => {
    onSelect(null)
    setQuery('')
    setMatches([])
    setOpen(false)
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setOpen(false)
      return
    }
    if (event.key === 'ArrowDown' && matches.length > 0) {
      event.preventDefault()
      setOpen(true)
      setHighlight((i) => (i + 1) % matches.length)
      return
    }
    if (event.key === 'ArrowUp' && matches.length > 0) {
      event.preventDefault()
      setHighlight((i) => (i - 1 + matches.length) % matches.length)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      if (open && matches[highlight]) choose(matches[highlight])
      else if (query.trim()) onSubmitRaw(query.trim())
    }
  }

  if (selected) {
    return (
      <div className="symbol-picked">
        <div className="symbol-picked-text">
          <span className="symbol-picked-name">{selected.name}</span>
          <span className="symbol-picked-meta mono">
            {selected.ticker} · {describeMatch(selected)}
            {selected.instrument === 'ETF' && ' · ETF'}
          </span>
        </div>
        <button type="button" className="ghost sm" onClick={clear} disabled={disabled}>
          변경
        </button>
      </div>
    )
  }

  return (
    <div className="symbol-search" ref={containerRef}>
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        placeholder="삼성전자, 005930, VOO…"
        value={query}
        disabled={disabled}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => matches.length > 0 && setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {open && matches.length > 0 && (
        <ul className="symbol-options" id={listId} role="listbox">
          {matches.map((match, index) => (
            <li key={match.ticker} role="option" aria-selected={index === highlight}>
              <button
                type="button"
                className={`symbol-option${index === highlight ? ' active' : ''}`}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => choose(match)}
              >
                <span className="symbol-option-name">{match.name}</span>
                <span className="symbol-option-meta mono">
                  {match.ticker} · {describeMatch(match)}
                  {match.instrument === 'ETF' && ' · ETF'}
                </span>
                {!match.confident && (
                  <span className="badge badge-amber">시장 확인 필요</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      {searching && query.trim() && <p className="symbol-search-status">검색 중…</p>}
      {!searching && !open && query.trim().length > 1 && matches.length === 0 && (
        <p className="symbol-search-status">
          후보가 없습니다. 티커를 알고 있다면 그대로 입력하고 추가를 눌러보세요.
        </p>
      )}
    </div>
  )
}
