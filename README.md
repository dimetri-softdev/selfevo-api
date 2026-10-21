# SelfEvo API

This repository contains the REST API used by the SelfEvo Android app. Firebase Authentication verifies user identity; PostgreSQL stores each user's habits, completion history, and player card.

## Local development

Requirements: Node.js 20 or newer and a PostgreSQL database.

1. Install dependencies:
   ```bash
   npm ci
   ```
2. Configure environment variables (never commit credentials):
   - `DATABASE_URL`: PostgreSQL connection string.
   - `FIREBASE_SERVICE_ACCOUNT_JSON`: Firebase Admin service-account JSON. Alternatively, set `FIREBASE_SERVICE_ACCOUNT_BASE64` to the base64-encoded complete JSON file; this avoids newline and quoting problems in deployment environment variables.
   - `FIREBASE_PROJECT_ID`: Firebase project ID (optional if included in the service-account JSON).
   - `DATABASE_SSL_MODE`: optional `disable`, `require`, or `verify-full`; production defaults to `verify-full`.
   - `PORT`: HTTP port (optional; defaults to `3000`).
3. Start the service:
   ```bash
   npm start
   ```

The database schema is created at startup. Check readiness at `GET /healthz`. API routes require a Firebase ID token in `Authorization: Bearer <token>`.

## Deploying to Render with PostgreSQL

1. Create a Render PostgreSQL database in the same region as the web service. Copy its internal connection string. A Neon database can also be used with its TLS-enabled connection string.
2. Deploy this repository as a Render **Web Service**, with `npm ci` as the build command and `npm start` as the start command. Select Node.js 20 or newer.
3. Set these Render environment variables:
   - `DATABASE_URL` — the PostgreSQL connection string.
   - `FIREBASE_SERVICE_ACCOUNT_BASE64` — recommended: base64-encoded complete service-account JSON. Alternatively, `FIREBASE_SERVICE_ACCOUNT_JSON` can contain the complete JSON directly.
   - `FIREBASE_PROJECT_ID` — your Firebase project ID.
   - `NODE_ENV=production`
   - `DATABASE_SSL_MODE=require` — only when the database presents a self-signed certificate, as in the reported Render startup error. This still encrypts the connection, but skips server certificate verification. Prefer `verify-full` when the database provides a certificate chain trusted by Node.
4. Set the Render health-check path to `/healthz`.
5. Enable Email/Password and Google providers in Firebase Authentication. For Google sign-in, configure the Android app's SHA fingerprints and OAuth clients, then download an updated `google-services.json` containing the web OAuth client ID.
6. Set the Android app's API base URL to the deployed HTTPS service before releasing it.

Keep the service-account JSON and database URL private. Do not place either in the Android app, source control, logs, or public build artifacts. Firebase client configuration in the Android app is not a substitute for the Admin SDK credentials on the server.

If startup reports `self-signed certificate`, set `DATABASE_SSL_MODE=require` in Render's API service environment and redeploy. Production otherwise verifies the database certificate by default.

If startup reports `Failed to parse private key`, revoke any exposed service-account key and generate a new key. Prefer setting `FIREBASE_SERVICE_ACCOUNT_BASE64` to the base64-encoded complete JSON file in Render and remove the old `FIREBASE_SERVICE_ACCOUNT_JSON` variable. In PowerShell, create the value without printing the key with `$json = Get-Content -Raw "$HOME\Downloads\your-service-account-file.json"; [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json)) | Set-Clipboard`, then paste the clipboard value into Render. Never paste the credential into chat or source control. Confirm `FIREBASE_PROJECT_ID` matches the JSON's `project_id`, save the variables, and redeploy.

## Endpoints

- `GET /healthz` — database readiness check; does not expose database details.
- `GET /api/habits?date=YYYY-MM-DD` — list the authenticated user's habits for that calendar date.
- `POST /api/habits` — create or idempotently synchronize one of the authenticated user's habits.
- `POST /api/habits/log` — record a completion with `habitId` and the user's local `completedOn` date; repeating the same request for the same date does not award stats again.
- `GET /api/sync/card` — get the authenticated user's player card.
- `PATCH /api/sync/card` — update the authenticated user's player name.

The authenticated user ID is taken only from the verified Firebase token. The API does not accept passwords or issue its own login tokens.

## Tests

```bash
npm test
```
