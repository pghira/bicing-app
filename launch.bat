@echo off
echo Starting Fast Bicing Finder Server...
echo Keep this terminal window open while using the app!
start http://localhost:8080/
echo.
echo ==================================================
echo IMPORTANT: To open on your phone, type this exact
echo URL into your phone's browser:
echo http://192.168.0.16:8080
echo ==================================================
echo.
python -m http.server 8080 --bind 0.0.0.0
