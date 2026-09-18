@echo off
chcp 65001 >nul
echo === 내장 일본 종목 목록 대조 ===
echo.
echo 손으로 적은 목록이라 종목코드가 틀릴 수 있습니다.
echo 야후가 아는 이름을 나란히 찍어줄 테니, 다른 회사로 보이는 줄이 있는지만 봐주세요.
echo (종목 하나만 볼 때: check-jp.bat 8766)
echo.

cd /d "%~dp0backend"
if not exist ".venv\Scripts\activate.bat" (
    echo [오류] .venv 폴더가 없습니다. setup.bat을 먼저 실행해주세요.
    pause
    exit /b 1
)
call .venv\Scripts\activate.bat

python check_jp_seed.py %*

echo.
pause
