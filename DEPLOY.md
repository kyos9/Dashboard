# 서버에 올리기 — 오라클 무료 티어

개인 PC에서 쓰는 동안은 필요 없습니다. 이 문서는 **폰에서도 열고, 껐다 켜도 알아서
갱신되게** 하려고 서버에 한 벌 띄우는 절차입니다.

한 번 해두면 그 뒤의 수정은 `git pull && docker compose up -d --build` 한 줄입니다.

> 순서가 중요한 곳이 두 군데 있습니다. **도메인이 서버를 가리킨 뒤에** 띄워야 인증서를
> 받고(4→6), **방화벽은 두 겹**이라 한쪽만 열면 안 열립니다(3).

---

## 0. 준비물

| | |
| --- | --- |
| 오라클 클라우드 계정 | 신용카드 확인이 필요하지만 Always Free 자원은 청구되지 않습니다 |
| 도메인 | 없어도 IP로 띄울 수는 있지만 **HTTPS를 못 받습니다.** 비밀번호가 평문으로 오갑니다 |
| SSH 키 | 인스턴스를 만들 때 공개키를 넣습니다 |

## 1. 인스턴스 만들기

Compute → Instances → Create instance.

| | 고를 것 |
| --- | --- |
| 이미지 | Ubuntu 24.04 (Canonical Ubuntu) |
| 모양 | **VM.Standard.A1.Flex** (Ampere ARM) — 4 OCPU / 24GB 까지 무료 |
| 네트워크 | 기본 VCN 그대로, "Assign a public IPv4 address" 켜기 |
| SSH 키 | 공개키 붙여넣기 |

**"Out of host capacity"가 뜨면** 그 리전의 ARM 재고가 없다는 뜻입니다. 흔합니다.

- 다른 가용성 도메인(AD-1/2/3)으로 바꿔서 다시 시도
- 1 OCPU / 6GB 로 줄여서 시도 (작게 잡을수록 잘 잡힙니다)
- 그래도 안 되면 **VM.Standard.E2.1.Micro**(AMD, 1GB). 돌아가긴 하지만 RAM이 빠듯해
  아래 2번의 스왑이 **필수**입니다
- 계정을 Pay As You Go 로 올리면 ARM 재고를 훨씬 잘 잡습니다 (무료 자원은 그대로 무료)

Docker로 띄우므로 여기서 막히면 다른 곳(예: 국내 VPS)으로 옮겨도 이 문서의 3번부터
그대로 씁니다. 붙잡고 있을 일이 아닙니다.

## 2. 서버 기본 설정

```bash
ssh ubuntu@<서버IP>

# 도커
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
exit          # 그룹 적용을 위해 한 번 나갔다 다시 들어옵니다
```

```bash
# 스왑 — RAM 1GB 인스턴스라면 필수입니다.
# 화면 빌드(node)가 메모리를 제법 먹어서, 없으면 `docker compose build`가
# 이유 없이 죽은 것처럼 끝납니다 (OOM Killer).
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## 3. 방화벽 — 두 겹입니다

**여기서 대부분 막힙니다.** 오라클은 클라우드 쪽과 서버 안쪽 양쪽에 방화벽이 있고,
둘 다 열어야 합니다. 한쪽만 열면 증상이 똑같습니다 — 그냥 응답이 없습니다.

**(1) 클라우드 쪽** — Networking → Virtual Cloud Networks → 해당 VCN → Security Lists
→ Default Security List → Add Ingress Rules:

| Source CIDR | 프로토콜 | 포트 |
| --- | --- | --- |
| 0.0.0.0/0 | TCP | 80 |
| 0.0.0.0/0 | TCP | 443 |

**(2) 서버 안쪽** — 오라클의 우분투 이미지는 22번 말고는 전부 막아둡니다.

```bash
sudo iptables -L INPUT --line-numbers    # REJECT 줄이 몇 번인지 먼저 봅니다
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save           # 안 하면 재부팅하면서 사라집니다
```

`6`은 마지막 REJECT 규칙 **앞** 자리입니다. 위에서 본 번호가 다르면 그 번호를 씁니다 —
REJECT 뒤에 넣으면 규칙은 있는데 아무 효과가 없습니다.

## 4. 도메인 연결

도메인 관리 화면에서 **A 레코드**를 서버 공인 IP로 지정합니다.

```bash
dig +short signal.example.com     # 서버 IP가 나와야 다음으로 갑니다
```

**이게 먼저입니다.** 도메인이 아직 다른 곳을 가리키는 상태로 띄우면 인증서 발급이
실패하고, Let's Encrypt에는 실패 횟수 제한이 있어 한동안 다시 시도할 수 없습니다.

## 5. 받아서 설정 채우기

```bash
git clone https://github.com/kyos9/Dashboard.git
cd dashboard
cp .env.example .env
nano .env
```

| 값 | 무엇 |
| --- | --- |
| `POSTGRES_PASSWORD` | DB 비밀번호. `python3 -c "import secrets; print(secrets.token_urlsafe(32))"` |
| `DASHBOARD_PASSWORD` | **화면을 여는 비밀번호.** 비워두면 아무나 들어옵니다 |
| `DOMAIN` | 4번에서 연결한 도메인 |
| `ACME_EMAIL` | 인증서 문제 알림받을 메일 (비워도 됨) |

## 6. 띄우기

```bash
docker compose --profile https up -d --build
```

첫 실행은 몇 분 걸립니다(화면 빌드 + 파이썬 패키지). 그동안 무슨 일이 일어나는지:

1. Postgres가 뜨고, 건강해질 때까지 앱이 기다립니다
2. 앱이 뜨면서 마이그레이션을 스스로 돌립니다 (그 직전에 백업을 한 벌 떠둡니다)
3. Caddy가 도메인 인증서를 받습니다 — 여기서 4번의 A 레코드가 필요합니다
4. 켜고 15초/30초 뒤에 상장목록·시세 따라잡기가 한 번씩 돕니다

```bash
docker compose ps                 # 셋 다 Up / healthy 인지
docker compose logs -f caddy      # 인증서를 받았는지 (certificate obtained)
docker compose logs -f app        # 마이그레이션·갱신 로그
```

브라우저에서 `https://<도메인>` → **비밀번호 칸이 뜨면 성공입니다.**

## 7. 확인

```bash
curl -s https://signal.example.com/api/health
# {"status":"ok","locked":true}  ← locked:true 여야 합니다
```

`locked:false`면 `.env`의 `DASHBOARD_PASSWORD`가 비어 있다는 뜻입니다. **공개된
주소에서 이 상태면 아무나 진단 화면과 로그를 봅니다.** 채우고 `docker compose up -d`.

## 8. 폰에 설치

브라우저로 도메인에 접속 → 공유 → "홈 화면에 추가". 아이콘·전체화면·알림은 아직
제대로 안 되어 있습니다 — 그게 6단계(PWA)입니다.

## 9. 이후 업데이트

```bash
cd dashboard && git pull && docker compose --profile https up -d --build
```

마이그레이션은 앱이 알아서 돌리고, 그 직전에 백업을 한 벌 뜹니다. 로그인은 유지됩니다
(서명 키가 `/data` 볼륨에 남습니다).

## 10. 백업 꺼내오기

백업은 서버 안 `app-data` 볼륨의 `/data/backups`에 7벌 쌓입니다. **서버가 통째로
사라지는 경우는 그 백업도 같이 사라지므로** 가끔 내 PC로 가져옵니다.

```bash
docker compose cp app:/data/backups ./backups   # 서버 안에서
scp -r ubuntu@<서버IP>:~/dashboard/backups .    # 내 PC에서
```

## 11. 내 PC의 데이터는?

서버는 빈 DB로 시작합니다. 옮기는 방법은 둘입니다.

- **다시 등록한다 (권장).** 시세·지표·시그널은 티커만 있으면 전부 다시 받아옵니다.
  손으로 넣을 것은 보유수량·목표비중·DCA 금액 정도입니다.
- **매수 기록까지 옮긴다.** `buy_execution`·`holding`은 다시 만들어낼 수 없는
  데이터라 옮기려면 SQLite → Postgres 이전 작업이 따로 필요합니다. 필요해지면
  그때 만듭니다 (`ROADMAP.md` 2-1의 "부모 없는 행" 주의사항이 여기에 걸립니다).

## 막혔을 때

| 증상 | 먼저 볼 곳 |
| --- | --- |
| 브라우저가 계속 기다리기만 함 | 3번 방화벽 **두 겹** 다 열었는지 |
| "사이트가 안전하지 않음" | `docker compose logs caddy` — 인증서를 못 받은 겁니다. 4번의 A 레코드 확인 |
| 502 Bad Gateway | 앱이 아직 뜨는 중이거나 죽었습니다. `docker compose logs app` |
| 빌드가 이유 없이 멈춤 | RAM 부족입니다. 2번의 스왑 |
| 비밀번호를 잊음 | `.env`에 그대로 있습니다. 바꾸면 들어와 있던 사람도 전부 나갑니다 |
