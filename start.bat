@echo off
REM ============================================================
REM  CampusTreasury - ONE-CLICK LAUNCHER
REM ============================================================

set "ROOT=%~dp0"

REM ---- 1) Make sure the backend venv exists ----
if not exist "%ROOT%backend\django\Scripts\python.exe" (
    echo [Setup] No virtual environment found - creating one now...
    pushd "%ROOT%backend"

    python -m venv django

    if errorlevel 1 (
        echo.
        echo [ERROR] Could not create the virtual environment.
        echo Make sure Python is installed and available.
        echo.
        pause
        exit /b 1
    )

    echo [Setup] Installing required packages...
    django\Scripts\python.exe -m pip install -r requirements.txt

    if errorlevel 1 (
        echo.
        echo [ERROR] Package installation failed.
        echo.
        pause
        popd
        exit /b 1
    )

    popd
    echo [Setup] Done.
    echo.
)

REM ---- 2) Start backend ----
start "CampusTreasury Backend" cmd /k ^
  "cd /d "%ROOT%backend" && echo ===================================================== && echo   CampusTreasury BACKEND (Django) && echo   Running at: http://127.0.0.1:8000/ && echo ===================================================== && echo. && "%ROOT%backend\django\Scripts\python.exe" manage.py runserver"

REM ---- Wait for backend ----
timeout /t 4 /nobreak >nul

REM ---- 3) Start frontend ----
start "CampusTreasury Frontend" cmd /k ^
  "cd /d "%ROOT%frontend" && echo ===================================================== && echo   CampusTreasury FRONTEND && echo   Running at: http://127.0.0.1:5500/ && echo ===================================================== && echo. && py -m http.server 5500"

REM ---- 4) Open browser ----
timeout /t 2 /nobreak >nul
start "" http://127.0.0.1:5500/index.html

echo.
echo Backend and frontend are starting.
echo Browser will open automatically.
echo.
timeout /t 3 >nul