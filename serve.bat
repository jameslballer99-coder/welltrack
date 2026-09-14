@echo off
title WellTrack local server
cd /d "%~dp0"
echo.
echo  WellTrack is running at http://localhost:8080
echo  Phone on the same Wi-Fi: http://^<this PC's IP^>:8080  (run ipconfig to find it)
echo  Note: offline mode and install-to-home-screen need HTTPS, so use the GitHub Pages address on your phone.
echo  Press Ctrl+C to stop.
echo.
python -m http.server 8080
