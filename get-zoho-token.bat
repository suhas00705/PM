@echo off
echo.
echo === Get a new Zoho refresh token ===
echo Copy each value from Zoho API Console - Self Client, then right-click here to paste and press Enter.
echo.
set /p CID="1) Paste Client ID (Client Secret tab): "
set /p CSEC="2) Paste Client Secret (Client Secret tab): "
set /p CODE="3) Paste the Code (Generate Code tab - use within 10 minutes): "
echo.
echo Asking Zoho...
echo.
curl -s -X POST "https://accounts.zoho.com/oauth/v2/token?grant_type=authorization_code&client_id=%CID%&client_secret=%CSEC%&code=%CODE%"
echo.
echo.
echo Copy the value after "refresh_token":" (starts with 1000.) and put it in Vercel as ZOHO_REFRESH_TOKEN.
echo If you see invalid_code: click Create on Generate Code again and rerun this file.
echo.
pause
