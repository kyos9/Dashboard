@echo off
chcp 65001 >nul
echo === 신호판 업데이트 ===
echo.

cd /d "%~dp0"

echo [1/4] 최신 코드 받기...
git pull origin claude/stock-management-dashboard-plan-sn8q3p
if errorlevel 1 (
    echo.
    echo [오류] git pull 실패. 위 메시지를 확인해주세요.
    echo 로컬에서 고친 파일이 충돌하면 git status 로 확인할 수 있습니다.
    pause
    exit /b 1
)

echo.
echo [2/4] 백엔드 패키지 갱신...
cd /d "%~dp0backend"
if not exist ".venv\Scripts\activate.bat" (
    echo [오류] .venv 폴더가 없습니다. setup.bat을 먼저 실행해주세요.
    pause
    exit /b 1
)
call .venv\Scripts\activate.bat
pip install -q -r requirements.txt
if errorlevel 1 (
    echo.
    echo [오류] 패키지 설치 실패. 위 메시지를 확인해주세요.
    pause
    exit /b 1
)

echo.
echo [3/4] 프런트엔드 패키지 갱신...
cd /d "%~dp0frontend"
call npm install --silent
if errorlevel 1 (
    echo.
    echo [오류] npm install 실패. 위 메시지를 확인해주세요.
    pause
    exit /b 1
)

echo.
echo [4/4] 화면 다시 빌드...
rem 백엔드가 내보내는 건 빌드 결과물이다. 이걸 빼먹으면 코드를 받아도 화면은 옛날 것이
rem 그대로 뜬다 — 가장 헷갈리는 종류의 "업데이트가 안 됐다"이다.
call npm run build
if errorlevel 1 (
    echo.
    echo [오류] 화면 빌드 실패. 위 메시지를 확인해주세요.
    pause
    exit /b 1
)

echo.
echo 업데이트 완료! stop.bat 으로 끈 뒤 start-all.bat 을 실행하세요.
echo 화면 왼쪽 위 버전 표시가 바뀌었는지 확인하면 반영 여부를 알 수 있습니다.
pause
