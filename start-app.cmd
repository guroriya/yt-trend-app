@echo off
chcp 65001 >nul
cd /d "%~dp0"
title TrendZap
echo.
echo   TrendZap を起動します（閉じると終了します）
echo.
python tools\open_app.py
if errorlevel 1 (
  echo.
  echo   起動できませんでした。Python が入っているか確認してください。
  echo   確認方法: PowerShell で  python --version
  echo.
  pause
)
