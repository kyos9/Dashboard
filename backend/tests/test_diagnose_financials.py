"""재무 출처 진단 스크립트 — 실제 조회는 서버에서만 되므로, 여기서는 둘을 본다.

1. 응답을 요약하는 부분이 공식 문서의 모양대로 읽는가
2. **DART 키가 출력에 절대 안 나오는가** — requests 는 실패한 주소를 오류 메시지에 그대로
   적는데, 키가 그 주소의 쿼리에 들어 있다. 출력은 채팅에 붙여 공유하는 것이다.
"""

from __future__ import annotations

import importlib.util
import io
import zipfile
from pathlib import Path

import pytest
import requests

SCRIPT = Path(__file__).resolve().parents[1] / "diagnose_financials.py"


@pytest.fixture
def diag(monkeypatch):
    spec = importlib.util.spec_from_file_location("diagnose_financials", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module._SECRETS.clear()
    return module


def test_dart_filed_date_comes_from_the_receipt_number(diag):
    assert diag.dart_filed_date("20250311000123") == "2025-03-11"
    assert diag.dart_filed_date("") == "?"
    assert diag.dart_filed_date("2025abc") == "?"


def test_corp_codes_keep_only_listed_companies(diag):
    xml = (
        "<result>"
        "<list><corp_code>00126380</corp_code><corp_name>삼성전자</corp_name>"
        "<stock_code>005930</stock_code></list>"
        "<list><corp_code>00999999</corp_code><corp_name>비상장</corp_name><stock_code> </stock_code></list>"
        "</result>"
    ).encode()
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("CORPCODE.xml", xml)
    assert diag.parse_corp_codes(buffer.getvalue()) == {"005930": ("00126380", "삼성전자")}


def test_sec_summary_counts_periods_filed_more_than_once(diag):
    # 같은 분기가 그 분기 10-Q 와 이듬해 10-Q(비교 기간)에 다시 실린다 — 공시일이 둘이다
    entries = [
        {"start": "2024-01-01", "end": "2024-03-31", "val": 10, "form": "10-Q", "filed": "2024-05-02"},
        {"start": "2024-01-01", "end": "2024-03-31", "val": 10, "form": "10-Q", "filed": "2025-05-01"},
        {"start": "2025-01-01", "end": "2025-03-31", "val": 12, "form": "10-Q", "filed": "2025-05-01"},
    ]
    summary = diag.summarize_sec_fact(entries)
    assert summary["count"] == 3
    assert summary["repeated"] == 1
    assert summary["forms"] == {"10-Q": 3}
    assert [e["end"] for e in summary["latest"]] == ["2024-03-31", "2025-03-31"]


def test_sec_tag_prefers_the_earlier_name_and_us_gaap(diag):
    facts = {
        "us-gaap": {"RevenueFromContractWithCustomerExcludingAssessedTax": {"units": {}},
                    "Revenues": {"units": {"USD": []}}},
        "ifrs-full": {"Revenue": {"units": {}}},
    }
    assert diag.pick_sec_tag(facts, diag.SEC_TAGS["매출"])[:2] == ("us-gaap", "Revenues")
    assert diag.pick_sec_tag({"ifrs-full": {"Revenue": {"u": 1}}}, diag.SEC_TAGS["매출"])[:2] == (
        "ifrs-full", "Revenue")
    assert diag.pick_sec_tag({}, diag.SEC_TAGS["매출"]) is None


def test_sec_contact_is_used_only_when_it_is_an_email(diag, monkeypatch):
    monkeypatch.setenv("OPERATOR_CONTACT", "https://open.kakao.com/o/abc")
    monkeypatch.setenv("PUBLIC_URL", "https://example.org")
    assert diag.sec_user_agents() == [("사이트 주소만", "asset-hub/1.0 (+https://example.org)")]

    monkeypatch.setenv("OPERATOR_CONTACT", "help@example.org")
    labels = [label for label, _ in diag.sec_user_agents()]
    assert labels == ["문의처 메일", "사이트 주소만"]


def test_dart_key_never_reaches_the_output(diag, monkeypatch, capsys):
    key = "0123456789abcdef0123456789abcdef01234567"
    monkeypatch.setenv("DART_API_KEY", key)

    def refuse(url, params=None, timeout=None):
        # requests 가 실제로 만드는 모양 — 실패한 주소가 쿼리째 메시지에 들어간다
        raise requests.ConnectionError(
            f"HTTPSConnectionPool(host='opendart.fss.or.kr', port=443): Max retries exceeded with url: "
            f"/api/corpCode.xml?crtfc_key={params['crtfc_key']}"
        )

    monkeypatch.setattr(diag.requests, "get", refuse)
    diag.check_dart(["005930.KS"])
    out = capsys.readouterr().out
    assert "crtfc_key=***" in out
    assert key not in out
    assert "(40자)" in out


def test_dart_error_message_is_scrubbed_too(diag, monkeypatch, capsys):
    key = "fedcba9876543210fedcba9876543210fedcba98"
    monkeypatch.setenv("DART_API_KEY", key)

    class Answer:
        headers = {"Content-Type": "application/json;charset=UTF-8"}
        text = f'{{"status":"010","message":"등록되지 않은 키입니다 {key}"}}'

    monkeypatch.setattr(diag.requests, "get", lambda *a, **k: Answer())
    diag.check_dart(["005930.KS"])
    out = capsys.readouterr().out
    assert "등록되지 않은 키" in out
    assert key not in out


def test_without_a_dart_key_it_says_how_to_get_one(diag, monkeypatch, capsys):
    monkeypatch.delenv("DART_API_KEY", raising=False)
    diag.check_dart(["005930.KS"])
    out = capsys.readouterr().out
    assert "DART_API_KEY 가 없습니다" in out
    assert "opendart.fss.or.kr" in out


def test_market_split(diag):
    assert [diag.market(t) for t in ("AAPL", "005930.KS", "035720.KQ", "7203.T", "BRK-B")] == [
        "US", "KR", "KR", "JP", "US"]
