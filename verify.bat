@echo off
chcp 65001 >nul
echo === 시세 값 검증 ===
echo.
echo 연결이 되는지가 아니라, 받아온 값을 믿고 써도 되는지 확인합니다.
echo (먼저 diagnose.bat으로 연결이 되는지 확인한 뒤 실행하세요)
echo.

cd /d "%~dp0backend"
if not exist ".venv\Scripts\activate.bat" (
    echo [오류] .venv 폴더가 없습니다. setup.bat을 먼저 실행해주세요.
    pause
    exit /b 1
)
call .venv\Scripts\activate.bat

python verify_live.py

echo.
echo 위 출력 전체를 복사해서 공유해주세요.
pause
