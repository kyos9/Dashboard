import { Component, type ReactNode } from 'react'

/**
 * 탭 화면을 그리다 넘어지면 앱 전체가 하얗게 비지 않게 막는다 (ROADMAP 8-5).
 *
 * 탭 코드를 나눈 뒤로는 탭을 열 때 조각을 받는다. 오프라인에서 한 번도 안 연 탭을 누르거나,
 * 업데이트 직후 한 번 새로고침한 뒤에도 조각을 못 받으면(`loadChunk`) 오류가 올라온다. 그걸
 * 그대로 두면 React 가 화면을 통째로 걷어낸다 — 헤더와 아래 탭까지 사라져 다른 탭으로 갈
 * 수도 없다. 여기서 받아 이 자리에만 안내를 띄운다. 헤더·탭은 남는다.
 *
 * 다른 탭으로 옮기면 다시 그려 본다(App 이 주소마다 새로 만든다).
 */
export class PageBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="callout amber page-failed" role="alert">
        <span className="ico" aria-hidden="true">
          ⚠
        </span>
        <div>
          <p>이 화면을 불러오지 못했습니다.</p>
          <p className="hint">
            인터넷 연결을 확인한 뒤 다시 불러오세요. 새 버전이 막 올라온 경우에도 다시 불러오면 됩니다.
          </p>
          <button className="sm" onClick={() => window.location.reload()}>
            다시 불러오기
          </button>
        </div>
      </div>
    )
  }
}
