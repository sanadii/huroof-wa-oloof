# Firebase Google Authentication

The browser uses Firebase Authentication only when all of these public Web configuration variables are present: `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, and `VITE_FIREBASE_APP_ID`. They are public client configuration, not server secrets. Do not paste real values into this repository, tickets, or test evidence.

## Firebase Console checklist

1. In **Authentication → Sign-in method**, enable both **Google** and **Anonymous**. Anonymous access is required for lazy room create/join; Google can link that existing guest session.
2. Add the support email shown by the Google provider setup and complete the Google OAuth consent screen for the intended audience.
3. In **Authentication → Settings → Authorized domains**, add each deployed application domain and local development host required by your team. An omitted domain produces an unauthorized-domain message in the app.
4. Place the four public Web config values in local/deployment environment configuration. Set `VITE_GAME_RUNTIME=firebase` plus the App Check site key separately only when enabling Firestore/Functions game runtime.
5. For emulators, set `VITE_USE_FIREBASE_EMULATORS=true`; Auth attaches to the local Auth emulator once for the shared Firebase app.

Google login proves identity only. It does not grant editor, admin, publication, entitlement, room role, or any other privilege. Firebase rules and server endpoints remain responsible for every protected operation.

## Administrative access

`/admin` requires a non-anonymous Google identity and a server-only `adminPrincipals/{uid}` record. The callable checks that the enabled registry roles and `authzVersion` exactly match the custom claims `adminRoles` and `authzVersion`; UI routing is only a usability guard. Role and category/reviewer scope changes are never direct browser Firestore writes. Refresh/revoke the Google token after a claim update.

The one-time bootstrap command is `tsx scripts/bootstrap-admin-principal.ts EXACT_UID emulator|staging`. It rejects missing exact UIDs, an emulator target without `FIRESTORE_EMULATOR_HOST`, and the known production project. It has no first-user, email-domain, or client-side elevation path. Do not run it against production.

Admin mutations are fail-closed unless `FUNCTIONS_EMULATOR=true` or the server-only `ADMIN_MUTATIONS_ENABLED=true` is deliberately configured. Release publication remains on the existing plan → prepare → exact verify → single-use barrier → CAS activation/rollback workflow; the Admin UI can only stage a blocked operation. Browser Firestore and Storage stay deny-by-default, apart from the existing room projection exception in `firestore.rules`.

If a guest session is present, the app uses Firebase `linkWithPopup` and verifies that the UID remains unchanged. Credential collisions leave the guest session intact; users must choose another account or resolve the existing account through support.
