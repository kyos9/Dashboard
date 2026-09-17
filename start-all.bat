@echo off
chcp 65001 >nul
setlocal

rem ============================================================================
rem  신호판 시작 — 창 없이, 프로세스 하나로.
rem
rem  예전에는 백엔드와 프런트엔드가 각자 검은 창에서 떠 있어야 했다. 프런트엔드
rem  개발 서버(vite)는 코드를 고칠 때 화면을 바로 바꿔주는 도구이지, 다 만든 화면을
rem  띄우는 데 필요한 게 아니다. 그래서 화면을 한 번 빌드해두고 백엔드가 직접
rem  내보낸다 — 띄울 게 하나뿐이고, 주소도 하나(http://localhost:8000)다.
rem
rem  로그는 이제 화면에 흘리지 않고 backend\logs\app.log에 쌓인다. 화면 오른쪽 위
rem  [진단]에서 경고·오류만 골라 볼 수 있고, 파일째 내려받을 수도 있다.
rem
rem  끄려면 stop.bat.
rem ============================================================================

if "%~1"=="run" goto :run

cd /d "%~dp0"

if not exist "backend\.venv\Scripts\pythonw.exe" (
    echo [오류] backend\.venv 가 없습니다. setup.bat 을 먼저 실행해주세요.
    pause
    exit /b 1
)

rem 이미 떠 있으면 두 번 띄우지 않는다 — 브라우저만 연다
netstat -ano | findstr /r /c:":8000 .*LISTENING" >nul 2>&1
if not errorlevel 1 (
    echo 신호판이 이미 실행 중입니다. 브라우저를 엽니다...
    start http://localhost:8000
    exit /b 0
)

rem 화면이 빌드돼 있어야 백엔드가 내보낼 수 있다. 빌드는 시간이 걸리므로
rem 숨기기 전에, 사용자가 진행 상황을 볼 수 있는 상태에서 한다.
if not exist "frontend\dist\index.html" (
    echo 화면을 빌드합니다. 처음 한 번은 조금 걸립니다...
    pushd frontend
    call npm run build
    if errorlevel 1 (
        echo.
        echo [오류] 화면 빌드에 실패했습니다. 위 메시지를 확인해주세요.
        popd
        pause
        exit /b 1
    )
    popd
)

echo 신호판을 시작합니다...
start "" wscript.exe "%~dp0scripts\hidden.vbs" "%~f0" run

rem 서버가 실제로 응답할 때까지 기다린다. 무작정 몇 초 자고 브라우저를 열면
rem 느린 PC에서는 "연결할 수 없음" 화면을 보게 된다.
for /l %%i in (1,1,40) do (
    curl --silent --fail --max-time 2 http://127.0.0.1:8000/api/health >nul 2>&1
    if not errorlevel 1 goto :ready
    timeout /t 1 /nobreak >nul
)

echo.
echo [오류] 서버가 응답하지 않습니다.
echo backend\logs\app.log 와 backend\logs\server.out 을 확인해주세요.
echo 창을 띄워 직접 보려면 start-backend.bat 을 실행하세요.
pause
exit /b 1

:ready
start http://localhost:8000
exit /b 0

rem ---- 여기부터는 숨은 창에서 도는 부분 ----
:run
cd /d "%~dp0backend"
if not exist "logs" mkdir "logs"
rem pythonw는 콘솔을 만들지 않는다. 대신 stdout/stderr가 갈 곳이 없으므로 반드시
rem 파일로 돌려준다 — 안 그러면 기동 실패 메시지가 통째로 사라진다.
.venv\Scripts\pythonw.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 >> "logs\server.out" 2>&1
exit /b
