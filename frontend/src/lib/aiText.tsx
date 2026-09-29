/**
 * AI 가 쓴 글을 나눈다 — 제목(`## `), 글머리(`- `, `1. `), 표(`| a | b |`), **굵게** 만 알아본다
 * (`components/AiText`). 표는 종목 분석(9-8)의 "핵심 정량 지표"가 쓴다.
 */
import type { ReactNode } from 'react'

export type Block =
  | { kind: 'heading'; text: string }
  | { kind: 'ul' | 'ol'; items: string[] }
  | { kind: 'p'; text: string }
  | { kind: 'table'; head: string[]; rows: string[][] }

/** `| a | b |` → ['a', 'b']. 양끝 막대는 있어도 없어도 된다 */
function cells(line: string): string[] {
  return line
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim())
}

/** 머리 아래 구분 줄 `|---|:---:|` */
const RULE = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/

export function parseAiText(text: string): Block[] {
  const blocks: Block[] = []
  const lines = text.split(/\r?\n/)
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n].trim()
    if (!line) continue
    // 표 — 막대로 시작하는 줄 다음에 구분 줄이 와야 표다. 아니면 그냥 글자로 둔다
    if (line.startsWith('|') && RULE.test((lines[n + 1] ?? '').trim())) {
      const head = cells(line)
      const rows: string[][] = []
      n += 2
      while (n < lines.length && lines[n].trim().startsWith('|')) {
        const row = cells(lines[n].trim())
        rows.push(head.map((_, i) => row[i] ?? ''))
        n++
      }
      n--
      blocks.push({ kind: 'table', head, rows })
      continue
    }
    const heading = line.match(/^#{1,6}\s+(.*)$/)
    const bullet = line.match(/^[-*•]\s+(.*)$/)
    const numbered = line.match(/^\d+[.)]\s+(.*)$/)
    const last = blocks[blocks.length - 1]
    if (heading) {
      blocks.push({ kind: 'heading', text: heading[1] })
    } else if (bullet || numbered) {
      const kind = bullet ? 'ul' : 'ol'
      const item = (bullet ?? numbered)![1]
      if (last && last.kind === kind) last.items.push(item)
      else blocks.push({ kind, items: [item] })
    } else {
      blocks.push({ kind: 'p', text: line })
    }
  }
  return blocks
}

/** `**굵게**` 만. 짝이 안 맞는 별표는 그대로 둔다. */
export function inline(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return parts
    .filter((part) => part !== '')
    .map((part, i) =>
      part.startsWith('**') && part.endsWith('**') && part.length > 4 ? (
        <strong key={i}>{part.slice(2, -2)}</strong>
      ) : (
        <span key={i}>{part}</span>
      ),
    )
}
