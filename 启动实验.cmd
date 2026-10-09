@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo 请先安装 Node.js，然后重新启动。
  pause
  exit /b 1
)
echo 启动后打开 http://127.0.0.1:4318
echo 保持本窗口打开，按 Ctrl+C 停止服务。
node runtime/server.mjs --production
if errorlevel 1 pause
