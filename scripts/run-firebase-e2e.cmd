@echo off
call npm run seed:firestore -- --demo
if errorlevel 1 exit /b %errorlevel%
if defined FIREBASE_E2E_GREP (
  call npx playwright test -c playwright.firebase.config.ts -g "%FIREBASE_E2E_GREP%"
) else (
  call npx playwright test -c playwright.firebase.config.ts
)
