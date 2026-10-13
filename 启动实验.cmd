@echo off
chcp 65001 >nul
cd /d "%~dp0"
where pnpm >nul 2>&1
if errorlevel 1 (
  echo 请先完成课程首次准备中的 Node.js 和 pnpm 设置。
  pause
  exit /b 1
)
if not exist node_modules (
  echo 请在本目录运行一次 pnpm install --frozen-lockfile，然后重新启动。
  pause
  exit /b 1
)
if not defined LAB_PORT set LAB_PORT=4318
echo 启动后打开 http://127.0.0.1:%LAB_PORT%
echo 保持本窗口打开，按 Ctrl+C 停止服务。
call pnpm dev
if errorlevel 1 pause
