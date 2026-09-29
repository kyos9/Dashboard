"""관리자만 쓰는 AI — 포트폴리오 진단(9-7)과 종목 분석(9-8).

**여기서는 그 사람의 것이 넘어간다** — 비중(현재·목표·차이)과 수익률. `ai_analysis` 의 정리들이
공용 숫자만 넘기는 것과 다르다. 개인에게 맞춘 조언은 투자자문 쪽으로 기우므로(ROADMAP 3절·9-7)
**관리자(주인) 계정에서만** 열린다 — 자기 포트폴리오를 자기 키로 보는 것이다.

그래도 지키는 선
- **%만 보낸다.** 평가금액·수량·평단가·현금 액수는 보내지 않는다. 비중과 수익률로 충분하고,
  금액은 AI 제공자에게 넘길 이유가 없다. 테스트가 고정한다.
- **보내는 내용은 화면에서 그대로 본다** (`preview`) — 정리들과 같은 길이다.
- 진단은 **사고팔 것을 정하지 않는다.** 종목 분석은 사용자가 준 틀대로 "편입 판단"을 적지만,
  단정하지 않고 판단을 돕는 자료로 쓴다.
"""

from __future__ import annotations

import datetime as dt

from sqlalchemy.orm import Session

from app.markets import currency_of_stock, market_of_stock
from app.services import ai_analysis as base
from app.services import fundamentals
from app.services import rebalance as rebalance_service
from app.services.providers import ai as providers
from app.services.users import ordered_user_stocks

_num = base._num

# --- 지시문 ------------------------------------------------------------------

PORTFOLIO_PROMPT = (
    '당신은 개인 투자자가 스스로 정한 규칙(목표 비중·밴드·리뷰일)으로 운용하는 포트폴리오를 점검하는 "진단 도우미"입니다.\n'
    + """\
사용자 본인의 포트폴리오 구성(모두 %)과 앱이 계산한 숫자를 받아, 지금 포트폴리오가 어떤 상태인지
한국어로 진단합니다. 사고팔지는 사용자가 정합니다.

반드시 지킬 것:
1. 특정 종목을 사라·팔라·얼마나 사고팔라고 정하지 않습니다. 목표 비중과의 차이는 사용자가 정한
   규칙(목표 비중·밴드·리뷰일)에 비춰 사실로 적습니다. (예: "A는 목표보다 +6.2%p 높아 밴드 5%p를 넘었습니다")
2. 앞으로의 주가·실적·금리를 예측하지 않고 목표가를 내지 않습니다.
3. 개별 종목을 "저평가", "고평가", "싸다", "비싸다"로 판단하지 않습니다. 포트폴리오의 **구성**(쏠림·분산·
   통화 노출·목표와의 차이)은 기준을 밝히고 평가해도 됩니다.
   (예: "상위 3종목이 투자 자산의 72%입니다 — 몇 종목의 움직임이 전체를 좌우하는 구성입니다")
4. 받은 데이터에 없는 사실(최근 뉴스, 실적 발표 내용, 업계 소식)을 지어내지 않습니다. 업종은 널리 알려진
   회사만 묶어 보고, 그렇게 묶었다고 밝힙니다. 확실하지 않은 회사는 묶지 않습니다.
5. 비어 있는 값은 비어 있다고 적고 추측으로 채우지 않습니다.
6. 금액은 받지 않았습니다 — 모든 숫자는 % 입니다. 금액을 추정하거나 되살리려 하지 않습니다.
7. """
    + base._RULE_SIGNALS
    + base._rule_request(8)
    + """
형식 (요청이 없을 때. 제목은 "## " 로 시작, 순서 그대로):
## 한눈에 보기
세 줄 이내. 지금 포트폴리오의 모양과 가장 눈에 띄는 점.
## 구성과 쏠림
상위 종목 비중, 시장·통화·사용자 분류별 비중, 현금 비중, 실질 종목 수. 업종 쏠림은 규칙 4대로.
## 목표 비중과의 차이
밴드를 넘은 종목, 차이가 큰 순서, 목표 합계, 리뷰일까지 남은 날.
## 성과는 어디서 났나
전체 수익률, 종목별 수익률이 어떻게 퍼져 있는지, 환율 몫이 있으면 그것까지.
## 눈여겨볼 점
3~5개. 각각 근거 숫자를 붙입니다.
## 시장 배경과의 관계
매크로 지표·국면 배지가 이 구성(통화·시장 노출)과 어떤 관계인지 사실로.
## 스스로 확인해 볼 점
사용자가 직접 찾아볼 만한 질문 3~5개.
## 데이터의 한계
"""
    + base._STYLE
    + "전체 길이는 한국어 1200~2500자 정도로 합니다.\n"
)

# 종목 분석 — 사용자가 준 틀 (ROADMAP 9-8). 숫자는 앱이 준 것을 쓰고, 없는 값은 "확인 필요".
RESEARCH_PROMPT = """\
당신은 개인 장기투자자를 위한 주식 애널리스트입니다. 사용자는 core-alpha-hedge 3버킷 구조로
포트폴리오를 운용하며, 알파 버킷은 종목당 동일 비중(~5%) 편입을 원칙으로 하고,
"지수를 이기되 지수 대비 다운사이드가 크게 벌어지지 않는 것"을 목표로 합니다.

앱이 모은 종목 데이터와 사용자의 포트폴리오 구성(비중 %)을 받아 아래 구조로 분석 리포트를 씁니다.
가격 흐름이나 기술적 지표는 다루지 않습니다(별도 시스템이 담당합니다) — 종목 자체(비즈니스, 재무,
밸류에이션, 산업 포지션)에 집중합니다.

반드시 지킬 것:
1. 숫자는 **앱이 준 것**을 씁니다. 앱이 주지 않은 값(선행 PER, 업종 평균, 순현금, PER 외의 역사적 밴드
   등)은 당신의 지식으로 채우지 말고 "확인 필요"로 적습니다. 추정치를 지어내지 않습니다.
2. 받은 데이터에 없는 최근 사실(뉴스, 실적 발표 내용, 경영진 발언)을 지어내지 않습니다. 당신의 지식은
   오래됐을 수 있습니다. 기업 개요·산업 포지션은 널리 알려진 범위에서만 쓰고, 확실하지 않으면 적지 않습니다.
3. 확정적 투자 조언이 아니라 "판단을 돕는 자료"로 씁니다. 매수·매도를 단정하지 않고 목표주가를 내지 않습니다.
   시나리오는 "어떤 조건에서 어떤 밸류에이션 배수가 정당화되는지"의 논리로 씁니다.
4. 사용자가 붙인 분류(예: core·alpha·hedge, 업종)가 있으면 버킷·익스포저 판단에 씁니다. 없으면 없다고 적습니다.
""" + base._rule_request(5) + """
출력 구조 (요청이 없을 때. 제목은 "## " 로 시작, 순서 그대로):
## 1. 기업 개요
3~4문장. 사업 모델, 핵심 매출원, 산업 내 포지션(밸류체인 상 위치 포함).
## 2. 핵심 정량 지표
표(| 지표 | 값 | 비교·코멘트 |)로. PER(trailing/forward), PBR, FCF Yield, ROE, 매출/영업이익 성장률
(3·5년 CAGR), 부채비율 또는 순현금, 배당수익률(해당 시). 코멘트는 한 줄 — 앱이 준 역사적 밴드(PER 5년)와
비교하고, 업종 평균은 받지 않았으니 "업종 평균 확인 필요"로.
## 3. 핵심 강점
최대 3개. 알파 종목으로서 지수 대비 초과수익을 낼 근거와, 그것이 왜 구조적·지속가능한지 한두 문장.
## 4. 핵심 리스크
최대 3개. 밸류에이션, 산업 사이클, 경쟁·규제, 매크로 민감도 등. 현실화되면 하방이 어디까지 열리는지 감을
잡을 수 있게.
## 5. 시나리오 분석
Bull / Base / Bear 각각 핵심 가정과 대략적 밸류에이션 배수 레인지.
## 6. 알파버킷 편입 판단
- 판단: [적합 / 조건부 적합 / 부적합] 중 하나
- 근거: 2~3문장
- 포트폴리오에 비슷한 익스포저(같은 업종·밸류체인, 예: 반도체/AI)가 이미 있으면 중복 리스크와 그 종목들의 비중
- 편입 시 유의할 리밸런싱·사이징 코멘트 (동일비중 원칙 고려)

글머리는 "- " 로 쓰고, 강조는 **굵게**만 씁니다. 표는 2번에만 쓰고, 코드블록·이모지는 쓰지 않습니다.
첫 줄에 "숫자는 앱이 모은 최신 공개 데이터(기준일) 기준"이라고 한 줄 밝힙니다.
전체 분량은 표를 빼고 한국어 800~1200자 내외로, 개인이 훑어보기 좋게 간결하게.
"""

OWNER_PROMPTS = {"portfolio": PORTFOLIO_PROMPT, "research": RESEARCH_PROMPT}


# ---------------------------------------------------------------------------
#  포트폴리오 — %만
# ---------------------------------------------------------------------------


def _group(rows: list[dict], key: str) -> list[tuple[str, float]]:
    out: dict[str, float] = {}
    for row in rows:
        out[row[key]] = out.get(row[key], 0.0) + row["actual"]
    return sorted(out.items(), key=lambda kv: -kv[1])


def _holding_rows(db: Session, user_id: int) -> tuple[dict, list[dict]]:
    """리밸런싱 현황을 %만 남긴 모양으로. 금액·수량·평단가는 여기서 떨어진다."""
    current = rebalance_service.compute_rebalance_current(db, user_id)
    stocks = {s.ticker: s for s in ordered_user_stocks(db, user_id, active_only=True)}
    rows = []
    for row in current["rows"]:
        stock = stocks.get(row["ticker"])
        if stock is None:
            continue
        held = row["quantity"] > 0
        if not held and not row["target_weight_pct"]:
            continue  # 보유도 목표도 없는 관심 종목 — 진단할 게 없다
        split = row["fx_split"] or {}
        rows.append({
            "ticker": stock.ticker,
            "name": stock.name or stock.ticker,
            "market": market_of_stock(stock).value,
            "currency": row["currency"],
            "category": stock.category or "분류 없음",
            "held": held,
            "actual": row["actual_weight_pct"],
            "target": row["target_weight_pct"],
            "gap": row["excess_pct"],
            "band": row["band_pct"],
            "reasons": row["rebalance_signal"]["reasons"],
            "return_pct": row["shown_return_pct"],
            "fx_applied": row["shown_currency"] != row["currency"],
            "price_pct": split.get("price_pct"),
            "fx_pct": split.get("fx_pct"),
            "shoulder": row["shoulder_signal_fired_in_period"],
        })
    return current, rows


def portfolio_context(db: Session, user_id: int, today: dt.date | None = None) -> dict:
    current, rows = _holding_rows(db, user_id)
    held = [r for r in rows if r["held"]]
    invested = sum(r["actual"] for r in held)
    # 투자 자산 안에서의 비중으로 — 현금을 빼고 종목끼리 얼마나 몰렸나
    inner = sorted((r["actual"] / invested * 100 for r in held), reverse=True) if invested > 0 else []
    for row in rows:
        public = base._price_section(db, row["ticker"])
        ind = base._indicator_section(db, row["ticker"], public.get("close"))
        sig = base._signal_section(db, row["ticker"])
        per = fundamentals.detail(db, row["ticker"], row["currency"], today, with_quarters=False)
        row["year_change_pct"] = public.get("year_change_pct")
        row["from_high_pct"] = public.get("from_high_pct")
        row["vs_ma200"] = (ind.get("vs_ma") or {}).get("ma200") if ind else None
        row["buy_today"] = sig["buy_today"]
        row["per"] = next((m["value"] for m in per["metrics"] if m["key"] == "per"), None)
        row["per_position"] = (per["per_range"] or {}).get("position_pct")
        row["as_of"] = public.get("date")
    review = current["review"]
    cash = current["cash"]
    cost = current["cost_value_base"]
    pnl = current["unrealized_pnl_base"]
    return {
        "base_currency": current["base_currency"],
        "rows": rows,
        "held_count": len(held),
        "cash": {"actual": cash["actual_pct"], "target": cash["target_pct"], "gap": cash["excess_pct"]},
        "invested_pct": invested,
        "top": {n: sum(inner[:n]) for n in (1, 3, 5) if len(inner) >= n},
        # 실질 종목 수 = 1 / Σ(비중²). 10종목이라도 한두 개에 몰려 있으면 2~3개처럼 움직인다
        "effective_n": 1 / sum((w / 100) ** 2 for w in inner) if inner else None,
        "by_market": _group(held, "market"),
        "by_currency": _group(held, "currency"),
        "by_category": _group(held, "category"),
        "total_return_pct": pnl / cost * 100 if cost and pnl is not None else None,
        "unpriced_count": current["unpriced_count"],
        "day_change_pct": current["day_change_pct"],
        "include_fx": current["include_fx_effect"],
        "target_sum": current["target_sum_pct"],
        "review": {
            "period": review["period"],
            "next_date": review["next_date"],
            "due": review["due"],
        },
        "macro": base._macro_section(db),
        "as_of": max((r["as_of"] for r in rows if r["as_of"]), default=None),
    }


PERIOD_LABELS = {"quarterly": "분기", "semiannual": "반기", "annual": "1년"}


def _pp(value: float | None) -> str:
    return _num(value, 1, "%p", signed=True)


def _pct(value: float | None, signed: bool = False) -> str:
    return _num(value, 1, "%", signed=signed)


def _groups(items: list[tuple[str, float]]) -> str:
    return ", ".join(f"{name} {_pct(value)}" for name, value in items) or "없음"


def render_portfolio(ctx: dict, question: str | None = None, today: dt.date | None = None) -> str:
    today = today or dt.date.today()
    rows = ctx["rows"]
    review = ctx["review"]
    days_left = (review["next_date"] - today).days if review["next_date"] else None
    lines = [
        "아래는 사용자 본인의 포트폴리오를 앱이 계산한 것입니다. 모든 값은 % 이고, 금액·수량·평단가는 보내지 않았습니다. "
        "정해진 형식대로 진단해 주세요.",
        "",
        "[전체]",
        f"- 기준통화 {ctx['base_currency']}. 비중은 현금까지 더한 전체 자금 대비입니다.",
        f"- 보유 종목 {ctx['held_count']}개, 투자 자산 {_pct(ctx['invested_pct'])}, "
        f"현금 {_pct(ctx['cash']['actual'])} (목표 {_pct(ctx['cash']['target'])}, 차이 {_pp(ctx['cash']['gap'])})",
        f"- 투자 자산 안에서 상위 종목 비중: "
        + (", ".join(f"상위 {n} {_pct(v)}" for n, v in ctx["top"].items()) or "없음")
        + f"; 실질 종목 수(1÷Σ비중²) {_num(ctx['effective_n'], 1)}",
        f"- 시장별 {_groups(ctx['by_market'])}",
        f"- 통화별 {_groups(ctx['by_currency'])}",
        f"- 사용자 분류별 {_groups(ctx['by_category'])}",
        f"- 전체 수익률(평단가를 아는 종목끼리) {_pct(ctx['total_return_pct'], True)}"
        + (f", 평단가를 모르는 보유 종목 {ctx['unpriced_count']}개는 빠짐" if ctx["unpriced_count"] else "")
        + f"; 최근 거래일 대비 {_num(ctx['day_change_pct'], 2, '%', True)}",
        "- 수익률 기준: " + ("외화 종목은 산 환율을 적은 것만 원화로(환율 몫 포함)" if ctx["include_fx"]
                           else "종목마다 거래 통화 그대로(환율 몫 제외)"),
        f"- 목표 비중 합계(현금 포함) {_pct(ctx['target_sum'])}",
        f"- 리뷰: 주기 {PERIOD_LABELS.get(review['period'], review['period'])}, 다음 리뷰일 {review['next_date']}"
        + (f" (오늘로부터 {days_left}일)" if days_left is not None else "")
        + (", 리뷰일이 지났거나 오늘입니다" if review["due"] else ""),
        "",
        "[종목 — 현재 비중 큰 순서. 비중은 전체 자금 대비, 차이 = 현재 − 목표]",
    ]
    for r in sorted(rows, key=lambda r: -r["actual"]):
        head = f"- **{r['name']}({r['ticker']})** {r['market']}·{r['currency']}·분류 {r['category']}"
        if not r["held"]:
            head += " — 보유 0 (목표만 있음)"
        lines.append(head)
        lines.append(
            f"  비중 {_pct(r['actual'])} / 목표 {_pct(r['target'])} / 차이 {_pp(r['gap'])} (밴드 ±{_num(r['band'], 1, '%p')})"
            + (f" — {', '.join(r['reasons'])}" if r["reasons"] else "")
        )
        perf = f"  수익률 {_pct(r['return_pct'], True)}"
        if r["fx_applied"] and r["price_pct"] is not None:
            perf += f" (주가 몫 {_pct(r['price_pct'], True)}, 환율 몫 {_pct(r['fx_pct'], True)})"
        perf += (f", 1년 등락률 {_pct(r['year_change_pct'], True)}, 52주 최고 대비 {_pct(r['from_high_pct'], True)}, "
                 f"MA200 대비 {_pct(r['vs_ma200'], True)}")
        lines.append(perf)
        per = f"PER {_num(r['per'], 1, '배')}" if r["per"] is not None else "PER 없음"
        if r["per_position"] is not None:
            per += f"(5년 중 지금 이하였던 날 {_num(r['per_position'], 0, '%')})"
        lines.append(
            f"  {per}; 오늘 매수 시그널 {base._yes(r['buy_today'])}"
            + ("; 이번 리뷰 기간에 매도 참고 시그널이 뜬 적 있음" if r["shoulder"] else "")
        )
    if not rows:
        lines.append("- 보유하거나 목표를 정한 종목이 없음")
    lines += ["", "[시장 배경 — 공용 매크로 지표]", *base._macro_lines(ctx["macro"]), "", base.SIGNAL_RULES,
              *base._request_lines(question)]
    return "\n".join(lines)


def portfolio_job(db: Session, user_id: int, question: str | None) -> base.Job:
    ctx = portfolio_context(db, user_id)
    if not ctx["rows"]:
        raise providers.error("no_portfolio", "no holdings or targets")
    return base.Job("portfolio", None, PORTFOLIO_PROMPT, render_portfolio(ctx, question), ctx["as_of"])


# ---------------------------------------------------------------------------
#  종목 분석
# ---------------------------------------------------------------------------

ANNUAL_LABELS = {"revenue": "매출", "operating_income": "영업이익", "net_income": "순이익"}


def research_context(db: Session, user_id: int, stock, today: dt.date | None = None) -> dict:
    currency = currency_of_stock(stock).value
    fund = fundamentals.research(db, stock.ticker, currency, today)
    _, rows = _holding_rows(db, user_id)
    return {
        "ticker": stock.ticker,
        "name": stock.name or stock.ticker,
        "category": stock.category,
        "market": market_of_stock(stock).value,
        "currency": currency,
        "price": fund["price"],
        "price_date": fund["price_date"],
        "fundamentals": fund,
        "portfolio": [
            {k: r[k] for k in ("ticker", "name", "market", "category", "actual", "target", "held")}
            for r in sorted(rows, key=lambda r: -r["actual"])
        ],
    }


def _annual_line(label: str, series: list, currency: str) -> str:
    if not series:
        return f"- 연간 {label}: 없음"
    return f"- 연간 {label}: " + ", ".join(f"{end.year}({end}) {base._money(value, currency)}" for end, value in series)


def _cagr_text(found: dict | None) -> str:
    if not found:
        return "계산 불가(연간 자료 부족 또는 적자)"
    return f"{_num(found['pct'], 1, '%', True)} ({found['from']}→{found['to']})"


def render_research(ctx: dict, question: str | None = None) -> str:
    cur = ctx["currency"]
    fund = ctx["fundamentals"]
    extras = fund.get("extras") or {}
    lines = [
        f"아래는 앱이 모은 {ctx['name']}({ctx['ticker']})의 데이터와 사용자의 포트폴리오 구성입니다. 정해진 구조대로 분석해 주세요.",
        "",
        "[종목]",
        f"- 이름: {ctx['name']} / 티커: {ctx['ticker']} / 시장: {ctx['market']} / 통화: {cur}",
        f"- 사용자가 붙인 분류: {ctx['category'] or '없음'}",
        f"- 기준일 {ctx['price_date'] or '없음'} 종가 {_num(ctx['price'])} {cur}"
        + (f", 시가총액(종가 × 공시 주식 수, 대략) {base._money(extras.get('market_cap'), cur)}" if extras.get("market_cap") else ""),
        "",
        "[재무 — 공시 기준. 비율은 최근 4분기 합산(TTM) 또는 최근 분기]",
    ]
    shown = [m for m in fund["metrics"] if m.get("value") is not None or m.get("note")]
    if not shown:
        lines.append("- 재무 자료 없음 (ETF 등이거나 아직 받지 않음)")
    for m in shown:
        label, _ = base.METRICS.get(m["key"], (m["key"], ""))
        basis = f" — {m['period_end']} 분기까지" if m.get("period_end") else ""
        lines.append(f"- {label}: {base._metric_value(m, cur)}{basis}")
    per = fund.get("per_range")
    if per:
        lines.append(
            f"- PER 지난 5년({per['since']}부터 {per['days']}일): 최저 {_num(per['min'], 1)}배, 중앙값 {_num(per['median'], 1)}배, "
            f"최고 {_num(per['max'], 1)}배. 지금 PER 이하였던 날의 비율 {_num(per['position_pct'], 0, '%')}"
        )
    if extras:
        fcf_basis = f" — {extras['fcf_basis']} 분기까지" if extras.get("fcf_basis") else ""
        lines.append(f"- FCF 수익률(최근 1년 FCF ÷ 시가총액): {_num(extras.get('fcf_yield'), 1, '%')}{fcf_basis}")
        for metric, label in ANNUAL_LABELS.items():
            lines.append(_annual_line(label, extras["annual"].get(metric) or [], cur))
        for metric in ("revenue", "operating_income"):
            spans = extras["cagr"].get(metric) or {}
            lines.append(
                f"- {ANNUAL_LABELS[metric]} 연평균 성장률: 3년 {_cagr_text(spans.get(3))}, 5년 {_cagr_text(spans.get(5))}"
            )
    lines += [
        "- 앱이 받지 않는 값: 선행 PER(컨센서스), 업종 평균, 순현금(현금성 자산), PER 외의 역사적 밴드 → 확인 필요",
        "",
        "[사용자의 포트폴리오 — 전체 자금 대비 비중(%), 현재 비중 큰 순서. 금액은 보내지 않았습니다]",
    ]
    for p in ctx["portfolio"]:
        mark = " ← 이 종목" if p["ticker"] == ctx["ticker"] else ""
        state = "" if p["held"] else ", 보유 0"
        lines.append(
            f"- {p['name']}({p['ticker']}) {p['market']}·분류 {p['category']}: 현재 {_pct(p['actual'])}, 목표 {_pct(p['target'])}{state}{mark}"
        )
    if not ctx["portfolio"]:
        lines.append("- 보유하거나 목표를 정한 종목 없음")
    if not any(p["ticker"] == ctx["ticker"] for p in ctx["portfolio"]):
        lines.append(f"- 이 종목({ctx['ticker']})은 아직 보유하지 않았고 목표 비중도 없습니다 (관심 종목).")
    lines += base._request_lines(question)
    return "\n".join(lines)


def research_job(db: Session, user_id: int, stock, question: str | None) -> base.Job:
    ctx = research_context(db, user_id, stock)
    return base.Job("research", stock.ticker, RESEARCH_PROMPT, render_research(ctx, question), ctx["price_date"])
