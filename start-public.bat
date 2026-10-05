@echo off
cd /d "%~dp0"
start "Lazzat Server" cmd /k "npm start"
timeout /t 3 /nobreak >nul
echo.
echo Public HTTPS tunnel ochilmoqda...
echo Tunnel URL chiqgach, uni .env faylidagi WEBAPP_URL ga yozing.
call npx localtunnel --port 5050
pause
