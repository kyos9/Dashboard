@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

rem 창이 없어졌으니 끄는 방법도 있어야 한다.
rem PID를 파일에 적어두는 방법도 있지만, 파일이 낡으면 엉뚱한 프로세스를 죽인다.
rem "8000번 포트를 듣고 있는 프로세스"가 곧 신호판이므로 그걸 찾아 끈다.

set FOUND=

for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:":8000 .*LISTENING"') do (
    taskkill /f /pid %%p >nul 2>&1
    if not errorlevel 1 set FOUND=1
)

if defined FOUND (
    echo 신호판을 종료했습니다.
) else (
    echo 실행 중인 신호판이 없습니다.
)

timeout /t 2 /nobreak >nul
