"""사용자가 보내는 글자·목록의 한도 (0.45.4, 제로베이스 점검 4번)."""

from __future__ import annotations

from app import schemas
from app.models import UserStock
from tests.factories import make_stock


def test_stock_name_and_category_limits(api):
    client, _ = api
    ok = {"ticker": "AAPL", "name": "가" * schemas.NAME_MAX, "category": "나" * schemas.CATEGORY_MAX}
    assert client.post("/api/stocks", json=ok).status_code == 200
    for field, size in (("name", schemas.NAME_MAX + 1), ("category", schemas.CATEGORY_MAX + 1)):
        res = client.put("/api/stocks/AAPL", json={field: "x" * size})
        assert res.status_code == 422, field
    res = client.post("/api/stocks", json={"ticker": "x" * (schemas.TICKER_MAX + 1)})
    assert res.status_code == 422
    # 추가할 때도 같은 한도 (뮤테이션: StockCreate.name 한도를 빼도 살아남았다)
    for field, size in (("name", schemas.NAME_MAX + 1), ("category", schemas.CATEGORY_MAX + 1)):
        res = client.post("/api/stocks", json={"ticker": "MSFT", field: "x" * size})
        assert res.status_code == 422, field


def test_an_old_long_name_is_still_read(api):
    """한도는 받을 때만 — 옛 데이터에 긴 이름이 있어도 목록은 그대로 읽힌다."""
    client, Session = api
    with Session() as db:
        make_stock(db, "LONG", name="긴" * 500)
    stocks = client.get("/api/stocks").json()
    assert [s["name"] for s in stocks if s["ticker"] == "LONG"] == ["긴" * 500]


def test_owner_with_more_than_thirty_stocks_can_still_reorder(api):
    """종목 수 한도(30)에서 빠지는 주인 — 순서 목록 한도를 30 으로 잡으면 여기서 깨진다(계획 검토 4)."""
    client, Session = api
    tickers = [f"T{i:02d}" for i in range(40)]
    with Session() as db:
        for i, ticker in enumerate(tickers):
            make_stock(db, ticker, sort_order=i)
    res = client.put("/api/stocks/order", json={"tickers": list(reversed(tickers))})
    assert res.status_code == 200, res.text
    with Session() as db:
        first = db.query(UserStock).order_by(UserStock.sort_order).first()
        assert first.ticker == "T39"
    too_many = client.put("/api/stocks/order", json={"tickers": ["X"] * (schemas.ORDER_MAX + 1)})
    assert too_many.status_code == 422


def test_settings_currency_maps_and_macro_codes_are_bounded(api):
    client, _ = api
    many = {f"C{i}": 1.0 for i in range(schemas.CURRENCY_KEYS_MAX + 1)}
    assert client.put("/api/rebalance/settings", json={"cash": many}).status_code == 422
    assert client.put("/api/rebalance/settings", json={"fx_overrides": {"X" * 9: 1.0}}).status_code == 422
    assert client.put("/api/macro/pinned", json={"codes": [f"C{i}" for i in range(schemas.CODES_MAX + 1)]}).status_code == 422


def test_password_is_bounded(api):
    client, _ = api
    assert client.post("/api/auth/login", json={"password": "x" * 257}).status_code == 422


def test_limits_stay_generous_in_plain_numbers(api):
    """한도를 기호(schemas.NAME_MAX)로만 시험하면 숫자를 줄여도 시험이 같이 줄어든다 — 계획에서 정한 값을 글자 그대로 (끝 검토 F5·F8·F9).
    넉넉해야 하는 까닭: 화면은 다른 칸만 고쳐도 이름·구분을 늘 다시 보낸다(옛 긴 값), 주인은 종목 30개 한도에서 빠진다."""
    client, Session = api
    assert client.post("/api/stocks", json={"ticker": "A" * 64}).status_code != 422  # 64자 티커(종목명 검색어)는 받는다
    assert client.post("/api/stocks", json={"ticker": "A" * 65}).status_code == 422  # 위로 풀어도 잡는다 (끝 검토 다시 N7)
    assert client.post("/api/stocks", json={"ticker": "MSFT", "name": "가" * 200, "category": "나" * 60}).status_code == 200
    assert client.put("/api/stocks/MSFT", json={"name": "가" * 201}).status_code == 422
    assert client.put("/api/stocks/MSFT", json={"category": "나" * 61}).status_code == 422
    tickers = [f"T{i:03d}" for i in range(500)]
    with Session() as db:
        for i, ticker in enumerate(tickers):
            make_stock(db, ticker, sort_order=i)
    assert client.put("/api/stocks/order", json={"tickers": tickers}).status_code == 200
    assert client.put("/api/stocks/order", json={"tickers": tickers + ["X"]}).status_code == 422
