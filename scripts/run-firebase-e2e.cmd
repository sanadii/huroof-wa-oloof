@echo off
call npm run functions:build
if errorlevel 1 exit /b %errorlevel%
call npm run seed:firestore -- --demo
if errorlevel 1 exit /b %errorlevel%
call npx playwright test -c playwright.firebase.config.ts
