import { Link } from 'react-router-dom'

/**
 * 종목 0개일 때 차트·재무·리밸런싱의 빈 화면 (0.45.0 D5). 세 곳의 말이 달랐고 리밸런싱에만 누를 곳이 있었다 —
 * 폰은 종목 관리가 "더보기" 안이라 단추가 없으면 길을 찾아야 한다.
 */
export function NoStocksYet({ title, shows }: { title: string; shows: string }) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      <p>종목 관리에서 종목을 담으면 여기에 {shows} 보입니다.</p>
      <Link to="/stocks" className="link-button">
        종목 추가하러 가기
      </Link>
    </div>
  )
}
