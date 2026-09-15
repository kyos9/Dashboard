@echo off
chcp 65001 >nul
echo === 처음 한 번만 실행하는 설치 스크립트입니다 ===
echo.

echo [1/3] 백엔드 가상환경 생성 및 패키지 설치...
cd /d "%~dp0backend"
if not exist ".venv" (
    python -m venv .venv
)
call .venv\Scripts\activate.bat
pip install -r requirements.txt
if errorlevel 1 (
    echo.
    echo [오류] 백엔드 패키지 설치에 실패했습니다. 위 에러 메시지를 확인해주세요.
    pause
    exit /b 1
)

echo.
echo [2/3] 프런트엔드 패키지 설치...
cd /d "%~dp0frontend"
call npm install
if errorlevel 1 (
    echo.
    echo [오류] 프런트엔드 패키지 설치에 실패했습니다. 위 에러 메시지를 확인해주세요.
    pause
    exit /b 1
)

echo.
echo [3/3] 설치 완료!
echo 이제부터는 start-all.bat만 더블클릭하면 바로 실행됩니다.
pause
