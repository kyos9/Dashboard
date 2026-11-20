import { useEffect, useRef, useState, type ReactNode } from 'react'
import { dropSide, placeAt } from '../../lib/reorder'
import { Icon } from '../icons/Icon'

export interface OrderItem {
  key: string
  label: string
  sub?: ReactNode
}

interface Props {
  items: OrderItem[]
  busy: boolean
  /** 방금 옮긴 것 — 그 줄을 잠깐 표시하고, 키보드로 옮겼으면 그 손잡이에 포커스를 둔다 */
  moved: string | null
  /** 끌어 놓은 뒤의 보이는 순서 */
  onDrop: (keys: string[], key: string) => void
  /** 키보드(위·아래 화살표)로 한 칸 */
  onStep: (key: string, direction: 'up' | 'down') => void
}

/**
 * 순서 바꾸기 — ≡ 손잡이를 잡고 끌어 옮긴다 (디자인 4차 목업 11 · ② 주인 답 "≡ 잡고 끌기 만들기").
 *
 * 폰 브라우저는 HTML 끌기(draggable)를 손가락으로 하지 않는다 — 그래서 포인터(손가락·마우스 같이)로 직접 한다.
 * 끄는 동안 자리를 미리 벌려 보이고, 놓으면 그 순서를 저장하게 넘긴다. 손잡이는 키보드로도 된다(위·아래 화살표).
 *
 * 끄는 동안의 움직임·놓기는 손잡이가 아니라 **창(window)** 에서 듣는다 — 아래로 끌면 끄는 줄이 DOM 에서 옮겨지며
 * 손잡이의 포인터 잡기가 풀려, 손잡이 밖에서 놓으면 끝나지 않고 저장도 없었다(② 반영 검토 조건 1).
 * 보이기만 한다 — 저장·되돌리기는 부르는 쪽(StockManager)이 들고 있다.
 */
export function DragOrderList({ items, busy, moved, onDrop, onStep }: Props) {
  const [dragging, setDragging] = useState<string | null>(null)
  // 잡은 손가락(포인터) — 다른 손가락·손바닥이 끌기를 움직이거나 끝내지 않게(② 반영 재검토 조건 1)
  const pointer = useRef<number | null>(null)
  const [preview, setPreview] = useState<string[] | null>(null)
  const listRef = useRef<HTMLOListElement>(null)
  // 창에서 듣는 처리기가 늘 지금 값을 보게
  const live = useRef({ items, preview, dragging, onDrop })
  useEffect(() => {
    live.current = { items, preview, dragging, onDrop }
  })
  const byKey = new Map(items.map((i) => [i.key, i]))
  const keys = preview ?? items.map((i) => i.key)

  useEffect(() => {
    if (!dragging) return
    const move = (e: PointerEvent) => {
      const { dragging: key, items: list } = live.current
      if (!key || e.pointerId !== pointer.current) return
      const row = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('li[data-ticker]')
      const target = row?.dataset.ticker
      if (!row || !target || !listRef.current?.contains(row) || target === key) return
      const side = dropSide(row.getBoundingClientRect(), { x: e.clientX, y: e.clientY }, false)
      setPreview((current) => placeAt(current ?? list.map((i) => i.key), key, target, side))
    }
    const finish = (e: PointerEvent) => {
      if (e.pointerId !== pointer.current) return
      const { dragging: key, items: list, preview: after, onDrop: drop } = live.current
      pointer.current = null
      setDragging(null)
      setPreview(null)
      // 브라우저·기기가 끌기를 빼앗으면(pointercancel — 전화가 오는 등) 저장하지 않고 제자리로
      if (!key || e.type === 'pointercancel') return
      const before = list.map((i) => i.key)
      const next = after ?? before
      if (next.join('\u0000') !== before.join('\u0000')) drop(next, key)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
    }
  }, [dragging])

  const start = (key: string, e: React.PointerEvent<HTMLElement>) => {
    if (busy || (e.pointerType === 'mouse' && e.button !== 0)) return
    e.preventDefault()
    if (pointer.current !== null) return // 이미 다른 손가락으로 끄는 중
    pointer.current = e.pointerId
    setDragging(key)
    setPreview(items.map((i) => i.key))
  }

  return (
    <ol className={`stock-list stock-order${dragging ? ' is-dragging' : ''}`} aria-label="종목 순서" ref={listRef}>
      {keys.map((key, i) => {
        const item = byKey.get(key)
        if (!item) return null
        return (
          <li
            key={key}
            className={`stock-row${moved === key ? ' just-moved' : ''}${dragging === key ? ' dragging' : ''}`}
            data-ticker={key}
          >
            <span
              className="drag-grip"
              role="button"
              tabIndex={0}
              aria-label={`${item.label} 순서 — 끌거나 위·아래 화살표`}
              aria-disabled={busy || undefined}
              title="잡고 끌어 옮깁니다 (위·아래 화살표도 됩니다)"
              ref={(el) => {
                // 키보드로 옮긴 뒤에도 같은 손잡이에 — 같은 자리를 다시 눌러 다른 종목이 움직이지 않게
                if (el && !busy && moved === key && !dragging && document.activeElement?.closest('.stock-order') && document.activeElement !== el) el.focus()
              }}
              onPointerDown={(e) => start(key, e)}
              onKeyDown={(e) => {
                if (busy || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
                e.preventDefault()
                if (e.key === 'ArrowUp' && i === 0) return
                if (e.key === 'ArrowDown' && i === keys.length - 1) return
                onStep(key, e.key === 'ArrowUp' ? 'up' : 'down')
              }}
            >
              <Icon name="grip" />
            </span>
            <span className="stock-row-name">
              <span className="stock-row-title">{item.label}</span>
              {item.sub && <span className="stock-row-sub hint">{item.sub}</span>}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
