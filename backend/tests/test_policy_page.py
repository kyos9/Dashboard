"""개인정보처리방침·이용약관과 문의처 (ROADMAP 4-4b).

방침 화면(`frontend/src/pages/Policy.tsx`)은 **코드가 실제로 하는 것만** 적어야 한다. 한도·보관
기간 같은 숫자는 서버 값이 바뀌면 방침이 조용히 거짓말이 된다 — 여기서 대조한다.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from app.routers.stocks import MAX_STOCKS_PER_USER
from app.services import auth, backup, limits
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
    ],
)
def test_policy_numbers_match_the_server(phrase):
    assert phrase in _flat(POLICY), f"방침에 '{phrase}' 가 없습니다 — 서버 값과 방침이 어긋났습니다"


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
