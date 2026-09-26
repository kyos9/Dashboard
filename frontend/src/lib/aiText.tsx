/**
 * AI 가 쓴 글을 나눈다 — 제목(`## `), 글머리(`- `, `1. `), **굵게** 만 알아본다 (`components/AiText`).
 */
import type { ReactNode } from 'react'

export type Block =
  | { kind: 'heading'; text: string }
  | { kind: 'ul' | 'ol'; items: string[] }
  | { kind: 'p'; text: string }

export function parseAiText(text: string): Block[] {
  const blocks: Block[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
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
