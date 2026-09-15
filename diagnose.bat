@echo off
chcp 65001 >nul
echo === 시세 수집 진단 ===
echo.

cd /d "%~dp0backend"
if not exist ".venv\Scripts\activate.bat" (
    echo [오류] .venv 폴더가 없습니다. setup.bat을 먼저 실행해주세요.
    pause
    exit /b 1
)
call .venv\Scripts\activate.bat

set TICKER=%1
if "%TICKER%"=="" set TICKER=VOO

python diagnose.py %TICKER%

echo.
echo 위 출력 전체를 복사해서 공유해주세요.
pause
