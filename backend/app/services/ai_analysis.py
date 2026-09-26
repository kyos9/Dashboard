"""AI 정리 — 앱이 이미 계산한 숫자를 AI 에게 넘겨 "무슨 뜻인지" 글로 받는다 (ROADMAP 3c).

**AI 에게 판단을 맡기지 않는다.** 이 앱의 선은 "사용자가 정한 규칙으로 계산해 보여주는
도구"다(3절 규제). AI 가 "지금 사세요"라고 쓰면 그 선을 넘는다. 그래서 시스템 프롬프트가
권유·예측·가치 판단을 막고, 형식을 "정리·설명"으로 묶는다.

**넘기는 것은 공용 데이터뿐이다** — 시세·지표·시그널·재무·매크로. 보유수량·목표비중·
평단가·현금처럼 **그 사람의 것은 넘기지 않는다.** 개인 사정에 맞춘 조언이 되는 순간
투자자문 쪽으로 기운다(3절). 사용자는 무엇이 넘어가는지 화면에서 그대로 볼 수 있다
(`GET /api/ai/context/{ticker}`) — 보이지 않는 것을 보내면 믿을 수 없다.

**AI 의 지식은 오래됐다.** 받은 숫자에 없는 뉴스·실적 내용을 지어내지 말라고 적는다.
"""

from __future__ import annotations

import datetime as dt

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.markets import currency_of_stock, market_of_stock
from app.models import SignalDaily
from app.services import fundamentals, macro, queries
from app.services.providers import ai as providers
from app.services.signals import knee_conditions

# 1년 전 종가·52주 고저를 보려면 1년치 거래일이 있어야 한다 (한국 ~248, 미국 ~252)
PRICE_ROWS = 270

METRICS: dict[str, tuple[str, str]] = {
    # 키 → (이름, 단위)
    "per": ("PER", "배"),
    "pbr": ("PBR", "배"),
    "dividend_yield": ("배당수익률", "%"),
    "roe": ("ROE", "%"),
    "operating_margin": ("영업이익률", "%"),
    "revenue_yoy": ("매출 성장(전년 동기 대비)", "%"),
    "operating_income_yoy": ("영업이익 성장(전년 동기 대비)", "%"),
    "eps_yoy": ("EPS 성장(전년 동기 대비)", "%"),
    "debt_ratio": ("부채비율", "%"),
    "fcf": ("FCF(최근 1년)", "money"),
}

SYSTEM_PROMPT = """\
당신은 개인 투자자가 스스로 정한 규칙으로 쓰는 주식 대시보드의 "정리 도우미"입니다.
사용자가 담은 종목 하나에 대해 앱이 계산한 숫자를 받아, 그 숫자가 무엇을 뜻하는지
한국어로 정리하고 설명합니다. 판단은 사용자가 합니다.

반드시 지킬 것:
1. 매수·매도·보유를 권하거나 암시하지 않습니다. "사세요", "파세요", "담아볼 만합니다",
   "비중을 늘리세요", "지금이 기회입니다" 같은 말을 쓰지 않습니다.
2. 앞으로의 주가·실적을 예측하지 않고 목표가를 내지 않습니다.
3. "저평가", "고평가", "싸다", "비싸다", "매력적", "위험하다"처럼 판단하는 말 대신,
   숫자가 어디쯤인지를 사실로 적습니다. (예: "PER 이 지난 5년 범위의 아래쪽 30% 안에 있습니다")
4. 받은 데이터에 없는 사실(최근 뉴스, 실적 발표 내용, 경영진 발언, 업계 소식)을 지어내지
   않습니다. 당신의 지식은 오래됐을 수 있습니다. 회사가 무슨 사업을 하는지는 널리 알려진
   범위에서 한 문장까지 적어도 되지만, 확실하지 않으면 적지 않습니다.
5. 비어 있는 값은 비어 있다고 적고 추측으로 채우지 않습니다.
6. 시그널은 사용자가 정해 둔 기계적 규칙이 그날 충족됐는지를 적은 기록일 뿐입니다.
   권유가 아니라는 전제로, 어떤 조건이 왜 충족됐거나 안 됐는지를 설명합니다.

형식 (제목은 "## " 로 시작, 순서 그대로):
## 한눈에 보기
세 줄 이내.
## 가격과 추세
## 시그널 규칙
## 재무
재무 자료가 없으면 "재무 자료 없음" 한 줄과 이유.
## 시장 배경
## 스스로 확인해 볼 점
사용자가 직접 찾아볼 만한 질문 3~5개. (예: "최근 분기 매출 증가가 어느 사업에서 나왔는지")
## 데이터의 한계

글머리는 "- " 로 쓰고, 강조는 **굵게**만 씁니다. 표·코드블록·이모지는 쓰지 않습니다.
전체 길이는 한국어 900~1800자 정도로 합니다.
"""

SIGNAL_RULES = """\
[시그널 규칙 — 사용자가 이 앱에서 쓰는 기계적 조건]
- 매수 시그널(무릎매수 v2): 네 조건이 모두 참인 날. ① -DI > +DI ② 이격도(종가÷MA20−1) < 0
  ③ 20일 표준편차가 5거래일 전보다 작거나, 거래량비(5일÷20일 평균) > 1.1 ④ ADX > 20.
  떨어지는 중에 적립식으로 사는 날을 고르는 보조 규칙이다. 기간 안에 안 뜨면 기간 마지막 날 산다.
- 매도 참고 시그널(어깨): 종가 > MA50, ADX 가 5거래일 전보다 큼, 5일 평균 거래량 > 20일 평균.
  참고용이며 매도는 정해 둔 리뷰일에만 한다."""


# ---------------------------------------------------------------------------
#  숫자 모으기
# ---------------------------------------------------------------------------


def _pct(a: float | None, b: float | None) -> float | None:
    if a is None or not b:
        return None
    return (a / b - 1) * 100


def _price_section(db: Session, ticker: str) -> dict:
    rows = queries.recent_prices(db, [ticker], limit=PRICE_ROWS).get(ticker, [])
    if not rows:
        return {}
    latest = rows[0]
    year_ago_day = latest.date - dt.timedelta(days=365)
    year = [r for r in rows if r.date > year_ago_day]
    before = [r for r in rows if r.date <= year_ago_day]
    high = max(year, key=lambda r: r.close)
    low = min(year, key=lambda r: r.close)
    return {
        "date": latest.date,
        "close": latest.close,
        "change_pct": _pct(latest.close, rows[1].close) if len(rows) > 1 else None,
        # 1년치가 다 없으면 1년 등락률은 비운다 — 있는 만큼으로 계산하면 "1년"이 아니다
        "year_change_pct": _pct(latest.close, before[0].close) if before else None,
        "high_52w": high.close,
        "high_52w_date": high.date,
        "low_52w": low.close,
        "low_52w_date": low.date,
        "from_high_pct": _pct(latest.close, high.close),
        "from_low_pct": _pct(latest.close, low.close),
        "days": len(year),
    }


def _indicator_section(db: Session, ticker: str, close: float | None) -> dict:
    rows = queries.recent_indicators(db, [ticker], limit=6).get(ticker, [])
    if not rows:
        return {}
    latest = rows[0]
    five_ago = rows[5] if len(rows) > 5 else None
    conditions = knee_conditions(latest, five_ago)
    return {
        "date": latest.date,
        "vs_ma": {
            name: _pct(close, getattr(latest, name))
            for name in ("ma20", "ma50", "ma200")
        },
        "disparity": latest.disparity,
        "roc5": latest.roc5,
        "adx": latest.adx,
        "adx_5d_ago": five_ago.adx if five_ago else None,
        "plus_di": latest.plus_di,
        "minus_di": latest.minus_di,
        "vol_ratio": latest.vol_ratio,
        "stddev20": latest.stddev20,
        "stddev20_5d_ago": five_ago.stddev20 if five_ago else None,
        "knee_conditions": conditions.model_dump(),
    }


def _signal_section(db: Session, ticker: str) -> dict:
    rows = queries.recent_signals(db, [ticker], limit=1).get(ticker, [])
    latest = rows[0] if rows else None
    since = (latest.date if latest else dt.date.today()) - dt.timedelta(days=365)
    count = db.query(func.count()).select_from(SignalDaily).filter(
        SignalDaily.ticker == ticker, SignalDaily.knee_buy_v2.is_(True), SignalDaily.date > since,
    ).scalar()
    return {
        "date": latest.date if latest else None,
        "buy_today": bool(latest.knee_buy_v2) if latest else None,
        "sell_ref_today": bool(latest.shoulder_sell_ref) if latest else None,
        "last_buy_date": queries.last_buy_signal_dates(db, [ticker]).get(ticker),
        "buys_last_year": int(count or 0),
    }


def _macro_section(db: Session) -> dict:
    view = macro.overview(db, None)
    return {
        "series": [
            {
                "name": s["name"],
                "value": s["value"],
                "unit": s["unit"],
                "transform": s.get("transform_label"),
                "as_of": s["as_of"],
                "zone": (s.get("zone") or {}).get("label"),
            }
            for s in view["series"]
            if s.get("value") is not None
        ],
        "term_spread": view.get("term_spread"),
        "badges": [{"label": b["label"], "detail": b["detail"]} for b in view.get("badges") or []],
    }


def build_context(db: Session, stock, today: dt.date | None = None) -> dict:
    """AI 에게 넘길 숫자 전부. **그 사람의 것(보유·비중·평단가)은 여기 없다.**"""
    currency = currency_of_stock(stock).value
    price = _price_section(db, stock.ticker)
    fund = fundamentals.detail(db, stock.ticker, currency, today, with_quarters=False)
    return {
        "ticker": stock.ticker,
        "name": stock.name or stock.ticker,
        "category": stock.category,
        "market": market_of_stock(stock).value,
        "currency": currency,
        "price": price,
        "indicators": _indicator_section(db, stock.ticker, price.get("close")),
        "signals": _signal_section(db, stock.ticker),
        "fundamentals": {
            "state": fund["state"],
            "metrics": fund["metrics"],
            "per_range": fund["per_range"],
        },
        "macro": _macro_section(db),
    }


# ---------------------------------------------------------------------------
#  글로 옮기기
# ---------------------------------------------------------------------------


def _num(value: float | None, digits: int = 2, unit: str = "", signed: bool = False) -> str:
    if value is None:
        return "없음"
    text = f"{value:+,.{digits}f}" if signed else f"{value:,.{digits}f}"
    return f"{text}{unit}"


def _money(value: float | None, currency: str) -> str:
    if value is None:
        return "없음"
    if currency == "KRW":
        if abs(value) >= 1e12:
            return f"{value / 1e12:,.2f}조 원"
        return f"{value / 1e8:,.0f}억 원"
    if abs(value) >= 1e9:
        return f"{value / 1e9:,.2f}B {currency}"
    return f"{value / 1e6:,.1f}M {currency}"


def _yes(value: bool | None) -> str:
    return "판정 불가(데이터 부족)" if value is None else ("충족" if value else "미충족")


def render_prompt(ctx: dict) -> str:
    cur = ctx["currency"]
    price = ctx["price"]
    ind = ctx["indicators"]
    sig = ctx["signals"]
    lines = [
        f"아래는 앱이 계산한 {ctx['name']}({ctx['ticker']})의 데이터입니다. 정해진 형식대로 정리해 주세요.",
        "",
        "[종목]",
        f"- 이름: {ctx['name']} / 티커: {ctx['ticker']} / 시장: {ctx['market']} / 통화: {cur}",
    ]
    if ctx.get("category"):
        lines.append(f"- 사용자가 붙인 분류: {ctx['category']}")

    lines += ["", "[가격]"]
    if price:
        lines += [
            f"- 기준일 {price['date']} 종가 {_num(price['close'])} {cur} (전일 대비 {_num(price['change_pct'], 2, '%', True)})",
            f"- 1년 등락률 {_num(price['year_change_pct'], 1, '%', True)}",
            f"- 52주 최고 {_num(price['high_52w'])} ({price['high_52w_date']}) — 지금은 최고가 대비 {_num(price['from_high_pct'], 1, '%', True)}",
            f"- 52주 최저 {_num(price['low_52w'])} ({price['low_52w_date']}) — 지금은 최저가 대비 {_num(price['from_low_pct'], 1, '%', True)}",
        ]
    else:
        lines.append("- 시세 없음")

    lines += ["", "[기술 지표]"]
    if ind:
        vs = ind["vs_ma"]
        cond = ind["knee_conditions"]
        lines += [
            f"- 기준일 {ind['date']}",
            f"- 종가가 이동평균 대비: MA20 {_num(vs['ma20'], 1, '%', True)}, MA50 {_num(vs['ma50'], 1, '%', True)}, "
            f"MA200 {_num(vs['ma200'], 1, '%', True)}",
            f"- 이격도(MA20 기준) {_num(ind['disparity'], 2, '%', True)}, 5일 등락률(ROC5) {_num(ind['roc5'], 2, '%', True)}",
            f"- ADX {_num(ind['adx'], 1)} (5거래일 전 {_num(ind['adx_5d_ago'], 1)}), +DI {_num(ind['plus_di'], 1)}, -DI {_num(ind['minus_di'], 1)}",
            f"- 거래량비(5일÷20일 평균) {_num(ind['vol_ratio'], 2)}, 20일 표준편차 {_num(ind['stddev20'], 2)}"
            f" (5거래일 전 {_num(ind['stddev20_5d_ago'], 2)})",
            f"- 매수 시그널 조건별: ① -DI>+DI {_yes(cond['di_bearish'])}, ② 이격도<0 {_yes(cond['disparity_negative'])}, "
            f"③ 변동성 축소 또는 거래량 증가 {_yes(cond['volatility_or_volume'])}, ④ ADX>20 {_yes(cond['adx_trending'])}",
        ]
    else:
        lines.append("- 지표 없음")

    lines += ["", "[시그널 기록]"]
    lines += [
        f"- 최근 판정일 {sig['date'] or '없음'}: 매수 시그널 {_yes(sig['buy_today'])}, 매도 참고 시그널 {_yes(sig['sell_ref_today'])}",
        f"- 마지막 매수 시그널 날짜: {sig['last_buy_date'] or '없음'}",
        f"- 지난 1년 매수 시그널이 뜬 날: {sig['buys_last_year']}일",
    ]

    fund = ctx["fundamentals"]
    lines += ["", "[재무 — 공시 기준, 최근 4분기 합산(TTM) 또는 최근 분기]"]
    shown = [m for m in fund["metrics"] if m.get("value") is not None or m.get("note")]
    if not shown:
        reason = {"none": "재무제표가 없는 종목(ETF 등)이거나 이 시장의 재무는 아직 받지 않는다",
                  "unsupported": "이 시장의 재무는 아직 받지 않는다",
                  "error": "재무를 받지 못했다",
                  None: "아직 재무를 받지 않았다"}.get(fund["state"], "재무 자료 없음")
        lines.append(f"- 재무 자료 없음 ({reason})")
    for m in shown:
        label, unit = METRICS.get(m["key"], (m["key"], ""))
        if m.get("value") is None:
            value = m["note"]
        elif unit == "money":
            value = _money(m["value"], cur)
        else:
            value = _num(m["value"], 1, unit)
        basis = f" — {m['period_end']} 분기까지" if m.get("period_end") else ""
        lines.append(f"- {label}: {value}{basis}")
    per = fund.get("per_range")
    if per:
        lines.append(
            f"- PER 지난 5년({per['since']}부터 {per['days']}일): 최저 {_num(per['min'], 1)}배, 중앙값 {_num(per['median'], 1)}배, "
            f"최고 {_num(per['max'], 1)}배. 지금 PER 이하였던 날의 비율 {_num(per['position_pct'], 0, '%')}"
        )

    mac = ctx["macro"]
    lines += ["", "[시장 배경 — 공용 매크로 지표]"]
    for s in mac["series"]:
        unit = "%" if s["unit"] == "percent" else ""
        label = f"{s['name']}{' ' + s['transform'] if s['transform'] else ''}"
        zone = f" ({s['zone']})" if s["zone"] else ""
        lines.append(f"- {label}: {_num(s['value'], 2, unit)}{zone} — {s['as_of']}")
    if mac.get("term_spread"):
        ts = mac["term_spread"]
        lines.append(f"- 장단기 금리차(10년−2년): {_num(ts['value'], 2, '%p', True)} — {ts['as_of']}")
    if mac["badges"]:
        lines.append("- 앱이 띄운 국면 배지: " + "; ".join(f"{b['label']}({b['detail']})" for b in mac["badges"]))
    if not mac["series"]:
        lines.append("- 매크로 자료 없음")

    lines += ["", SIGNAL_RULES]
    return "\n".join(lines)


def preview(db: Session, stock) -> dict:
    """무엇을 보내는지 그대로 — 화면의 "보내는 내용 보기"."""
    ctx = build_context(db, stock)
    return {
        "ticker": stock.ticker,
        "as_of": (ctx["price"] or {}).get("date"),
        "system": SYSTEM_PROMPT,
        "prompt": render_prompt(ctx),
    }


def analyze(db: Session, stock, provider_name: str, model: str, key: str) -> dict:
    provider = providers.get(provider_name)
    model = providers.check_model(model)
    key = providers.check_key(key)
    ctx = build_context(db, stock)
    # 제공자를 부르는 동안 DB 연결을 붙잡지 않는다 — 수십 초 걸린다
    db.close()
    reply = provider.generate(key, model, SYSTEM_PROMPT, render_prompt(ctx))
    if not reply.text:
        raise providers.error("empty", f"{provider.name}: empty reply")
    return {
        "ticker": stock.ticker,
        "provider": provider.name,
        "model": reply.model,
        "text": reply.text,
        "truncated": reply.truncated,
        "as_of": (ctx["price"] or {}).get("date"),
        "generated_at": dt.datetime.now(dt.timezone.utc),
        "input_tokens": reply.input_tokens,
        "output_tokens": reply.output_tokens,
    }
