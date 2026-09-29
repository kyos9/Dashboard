import { inline, parseAiText } from '../lib/aiText'

/**
 * AI 가 쓴 글을 화면에 — 제목(`## `), 글머리(`- `, `1. `), 표, **굵게** 만 알아본다.
 *
 * HTML 로 넣지 않는다(`dangerouslySetInnerHTML` 없음). 남의 서버가 만든 글이라 그 안에
 * 무엇이 섞여 와도 글자로만 보여야 한다. 모르는 표시(코드블록 등)는 그냥 글자로 남는다.
 *
 * 표는 폰에서도 잘리지 않게 칸 안에서 줄을 바꾼다 (가로로 밀어 숨기지 않는다).
 */

export function AiText({ text }: { text: string }) {
  return (
    <div className="ai-text">
      {parseAiText(text).map((block, i) => {
        if (block.kind === 'heading') return <h4 key={i}>{inline(block.text)}</h4>
        if (block.kind === 'p') return <p key={i}>{inline(block.text)}</p>
        if (block.kind === 'table')
          return (
            <table key={i} className="ai-table">
              <thead>
                <tr>
                  {block.head.map((cell, j) => (
                    <th key={j} scope="col">
                      {inline(cell)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, r) => (
                  <tr key={r}>
                    {row.map((cell, j) => (
                      <td key={j}>{inline(cell)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )
        const List = block.kind
        return (
          <List key={i}>
            {block.items.map((item, j) => (
              <li key={j}>{inline(item)}</li>
            ))}
          </List>
        )
      })}
    </div>
  )
}
