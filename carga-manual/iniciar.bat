@echo off
cd /d "%~dp0"

where py >nul 2>&1
if not errorlevel 1 (
  set "PYTHON=py"
) else (
  where python >nul 2>&1
  if errorlevel 1 (
    echo No se encontro Python.
    echo Instalalo desde https://www.python.org/downloads/
    echo y activa la opcion "Add Python to PATH".
    echo.
    pause
    exit /b 1
  )
  set "PYTHON=python"
)

"%PYTHON%" -c "import PIL" >nul 2>&1
if errorlevel 1 (
  echo Instalando el componente necesario...
  "%PYTHON%" -m pip install -r requirements.txt
)
"%PYTHON%" generar_credencial.py
echo.
pause
