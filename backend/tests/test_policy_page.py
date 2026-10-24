"""개인정보처리방침·이용약관과 문의처 (ROADMAP 4-4b).

방침 화면(`frontend/src/pages/Policy.tsx`)은 **코드가 실제로 하는 것만** 적어야 한다. 한도·보관
기간 같은 숫자는 서버 값이 바뀌면 방침이 조용히 거짓말이 된다 — 여기서 대조한다.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from app.routers.stocks import MAX_STOCKS_PER_USER
from app.services import alerts, auth, backup, limits, push
from app.services import google_login as google
from tests import test_google_login as gl

google_on = gl.google_on

FRONTEND = Path(__file__).resolve().parents[2] / "frontend" / "src"
POLICY = (FRONTEND / "pages" / "Policy.tsx").read_text(encoding="utf-8")
DASHBOARD = (FRONTEND / "pages" / "Dashboard.tsx").read_text(encoding="utf-8")


def _flat(text: str) -> str:
    """JSX 는 줄을 바꿔 쓰므로 공백을 하나로 모아서 찾는다."""
    return " ".join(text.split())


@pytest.mark.parametrize(
    "phrase",
    [
        f"종목은 한 사람이 {MAX_STOCKS_PER_USER}개까지",
        f"처음 받는 종목은 하루 {limits.NEW_TICKERS_PER_DAY}개까지",
        f"같은 종목 새로고침은 {limits.REFRESH_COOLDOWN_SECONDS // 60}분에 한 번",
        f"바깥 검색은 분당 {limits.YAHOO_SEARCHES_PER_MINUTE}번까지",
        f"최근 {backup.KEEP}벌",
        f"최대 {backup.KEEP}일",
        f"최대 {auth.SESSION_SECONDS // 86400}일",
        f"확인용 쿠키를 {google.FLOW_SECONDS // 60}분",
        f"한 사람당 {alerts.MAX_DEVICES}대까지",
        f"AI 분석은 분당 {limits.AI_ANALYSES_PER_MINUTE}번까지",
    ],
)
def test_policy_numbers_match_the_server(phrase):
    assert phrase in _flat(POLICY), f"방침에 '{phrase}' 가 없습니다 — 서버 값과 방침이 어긋났습니다"


def test_policy_names_every_push_service_we_send_to():
    """알림이 거쳐 가는 회사를 방침이 다 적었는가. 허용 목록(`push.PUSH_HOSTS`)이 늘면 방침도 고친다."""
    vendors = {
        "fcm.googleapis.com": "구글",
        "android.googleapis.com": "구글",
        "updates.push.services.mozilla.com": "모질라",
        "web.push.apple.com": "애플",
        ".push.apple.com": "애플",
        ".notify.windows.com": "마이크로소프트",
    }
    assert set(push.PUSH_HOSTS) | set(push.PUSH_HOST_SUFFIXES) == set(vendors)
    flat = _flat(POLICY)
    for vendor in set(vendors.values()):
        assert vendor in flat


def test_first_screen_states_the_same_cap():
    assert f"종목은 {MAX_STOCKS_PER_USER}개까지" in _flat(DASHBOARD)


def test_policy_names_what_google_login_asks_for():
    """구글에 요청하는 범위(`openid email profile`)가 곧 받는 정보다. 늘리면 방침도 고친다."""
    assert sorted(google.SCOPES.split()) == ["email", "openid", "profile"]
    flat = _flat(POLICY)
    for item in ("구글 계정 식별자", "이메일 주소", "이름"):
        assert item in flat


# --- 문의처 -------------------------------------------------------------------


def test_status_carries_the_contact_the_owner_chose(api, google_on, monkeypatch):
    client, _ = api
    monkeypatch.setenv(google.OPERATOR_CONTACT_ENV, "  문의  help@example.org \n")
    assert client.get("/api/auth/status").json()["contact"] == "문의 help@example.org"


def test_no_contact_means_no_field_and_never_the_owner_email(api, google_on):
    """주인 이메일은 로그인 설정이지 공개하려고 적은 것이 아니다 — 대신 꺼내지 않는다."""
    client, _ = api
    body = client.get("/api/auth/status").json()
    assert "contact" not in body
    assert gl.OWNER not in str(body)


def test_contact_is_cut_to_a_line(monkeypatch):
    monkeypatch.setenv(google.OPERATOR_CONTACT_ENV, "x" * 500)
    assert google.operator_contact() == "x" * 200


def test_the_pc_copies_are_kept_as_the_policy_says():
    """서버 밖(관리자 PC)의 사본 수 — `server-backup-pull.bat` 이 지우는 수와 방침 5절이 같다 (0.45.0 A)."""
    import re

    bat = (FRONTEND.parents[1] / "server-backup-pull.bat").read_text(encoding="utf-8")
    keep = re.search(r"Select-Object -Skip (\d+)", bat)
    assert keep is not None
    assert f"최근 {keep.group(1)}벌만 남깁니다" in bat
    assert f"관리자 PC)으로 꺼낸 백업 사본도 최근 {keep.group(1)}벌만 두고" in _flat(POLICY)


# ---------------------------------------------------------------------------
#  AI 에게 보내는 것 — 방침 3절과 실제 문맥 (0.45.4)
# ---------------------------------------------------------------------------
#
# 방침은 "무엇을 보내는지"를 기능마다 적는다. 그 말이 거짓이 되는 것은 숫자가 아니라 **보내는 칸이
# 늘 때**다 — 그래서 칸을 허용 목록으로 고정한다. 하나라도 늘거나 바뀌면 여기서 멈추고, 방침 3절을
# 같이 고친 뒤 이 목록을 고친다. (금지 목록이면 이름이 다른 금액 칸은 조용히 지나간다 — 계획 검토자 5)

# 포트폴리오 진단 — 종목 한 줄에 실리는 칸
PORTFOLIO_ROW_KEYS = {
    "ticker", "name", "market", "currency", "category", "held", "actual", "target", "gap", "band", "reasons",
    "return_pct", "fx_applied", "price_pct", "fx_pct", "shoulder",
    # 공용 데이터
    "year_change_pct", "from_high_pct", "vs_ma200", "buy_today", "per", "per_position", "as_of",
}
PORTFOLIO_KEYS = {
    "thresholds", "base_currency", "rows", "held_count", "cash", "invested_pct", "top", "effective_n",
    "by_market", "by_currency", "by_category", "total_return_pct", "unpriced_count", "day_change_pct",
    "include_fx", "target_sum", "review", "macro", "as_of",
}
PORTFOLIO_CASH_KEYS = {"actual", "target", "gap"}  # % 뿐 — 현금 액수는 없다
# 종목 분석 — 그 종목 + 내가 담은 종목들. 수익률은 없다
RESEARCH_KEYS = {"ticker", "name", "category", "market", "currency", "price", "price_date", "fundamentals", "portfolio"}
RESEARCH_PORTFOLIO_KEYS = {"ticker", "name", "market", "category", "actual", "target", "held"}


@pytest.fixture
def ai_contexts(db_session):
    from app.services import ai_portfolio
    from app.models import UserStock
    from tests.test_ai_owner import _portfolio

    _portfolio(db_session)
    stock = db_session.query(UserStock).filter_by(ticker="ACME").one()
    return (ai_portfolio.portfolio_context(db_session, 1),
            ai_portfolio.research_context(db_session, 1, stock))


def test_ai_contexts_send_only_what_the_policy_lists(ai_contexts):
    portfolio, research = ai_contexts
    hint = "AI 에 보내는 칸이 바뀌었습니다 — 방침 3절(Policy.tsx)을 같이 고치고 이 목록을 고치세요"
    assert set(portfolio) == PORTFOLIO_KEYS, hint
    assert portfolio["rows"], "시험 포트폴리오가 비었다"
    for row in portfolio["rows"]:
        assert set(row) == PORTFOLIO_ROW_KEYS, hint
    assert set(portfolio["cash"]) == PORTFOLIO_CASH_KEYS, hint
    assert set(research) == RESEARCH_KEYS, hint
    assert research["portfolio"], "시험 포트폴리오가 비었다"
    for row in research["portfolio"]:
        assert set(row) == RESEARCH_PORTFOLIO_KEYS, hint


def test_policy_says_what_each_ai_feature_sends():
    flat = _flat(POLICY)
    # 기능 이름이 방침에 있다
    for feature in ("AI 정리", "AI 포트폴리오 진단", "AI 종목 분석"):
        assert f"<b>{feature}</b>" in flat, feature
    portfolio = flat[flat.index("<b>AI 포트폴리오 진단</b>"):flat.index("<b>AI 종목 분석</b>")]
    research = flat[flat.index("<b>AI 종목 분석</b>"):]
    research = research[:research.index("</li>")]
    # 진단은 비중·밴드·수익률·현금 비중·리뷰·내 시그널 기준을, 종목 분석은 비중을 보내고 수익률은 안 보낸다
    for word in ("비중", "밴드", "수익률", "현금 비중", "리뷰", "시그널 기준", "분류"):
        assert word in portfolio, word
    for word in ("비중", "분류", "웹 검색"):
        assert word in research, word
    assert "수익률은 보내지 않습니다" in research
    # 금액은 어느 쪽도 보내지 않는다 — 그리고 예전의 "목표비중은 보내지 않는다"는 이제 거짓이라 없다
    assert "금액은 보내지 않습니다" in flat
    assert "목표비중처럼 나의 포트폴리오는 보내지 않" not in flat
