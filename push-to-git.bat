@echo off
cd /d "C:\Users\suhas.s\Downloads\PMportalready"

echo.
echo === Git Status ===
git status

echo.
echo === Staging all changes ===
git add .

echo.
echo === Committing ===
set /p MSG="Enter commit message (or press Enter for default): "
if "%MSG%"=="" set MSG=Update portal changes

git commit -m "%MSG%"

echo.
echo === Pushing to GitHub ===
git push origin main

echo.
echo === Done! ===
git log --oneline -3
pause
