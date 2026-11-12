# ChatSphere — Clean Full-Stack Project

ChatSphere is split into one frontend and one backend so you do not have to deal with duplicate `src` folders or run the wrong `server.ts` file.

## Folder structure

```text
ChatSphere/
├── client/                  Next.js + React + TypeScript + Tailwind/DaisyUI
│   ├── public/images/       Landing page images
│   ├── src/
│   │   ├── components/     Reusable UI
│   │   ├── context/        Auth, navigation and Pusher realtime state
│   │   ├── lib/api.ts      API client, CSRF and media uploader
│   │   ├── app/            Next.js routes
│   │   ├── views/          Landing, auth, chat, profile, admin screens
│   │   ├── types/          Frontend types
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── package.json
│   ├── next.config.ts
│   ├── server.mjs          Unified production HTTP server entry point
│   └── .env.example
├── server/                  Express + Pusher + Prisma backend
│   ├── prisma/
│   │   ├── schema.prisma
│   │   └── migrations/
│   ├── scripts/             Admin bootstrap utility
│   ├── src/
│   │   ├── config/          Environment and logging
│   │   ├── db/              Prisma and local embedded PostgreSQL
│   │   ├── middleware/      Security, auth and error handling
│   │   ├── routes/          API endpoints
│   │   ├── services/        Email, Cloudinary, audit and messaging
│   │   ├── realtime/        Pusher event publishing
│   │   └── index.ts         Backend entry point
│   ├── tests/               Automated end-to-end tests
│   ├── package.json
│   └── .env.example
├── INSTALL.bat
├── RUN-CLIENT.bat
├── RUN-SERVER.bat
├── RUN-BOTH.bat
├── TEST-SERVER.bat
└── package.json             Root shortcuts
```

The Next.js frontend lives in `client`; Express, Pusher and Prisma live in `server`. The root-level Vite config is not the production frontend configuration.

## Requirements

- Windows 10/11
- Node.js 22 LTS (includes npm)
- Internet connection for installing npm packages

Verify Node and npm in PowerShell:

```powershell
node -v
npm -v
```

## Quick start on Windows

1. Extract this ZIP to a normal folder, for example `C:\Projects\ChatSphere`.
2. Double-click `INSTALL.bat` once and allow both frontend and backend dependencies to install.
3. Double-click `RUN-SERVER.bat`. Keep its terminal open.
4. Double-click `RUN-CLIENT.bat`. Keep its terminal open too.
5. Open `http://localhost:3000` in Chrome.

The server launcher creates `server/.env` from `server/.env.example` on first launch. Local development uses the backend's embedded PostgreSQL engine, so you do not need to install PostgreSQL or create a Neon database just to start the project. Its database and generated development signing keys are created under `server/.pgdata/` and are intentionally excluded from the ZIP.

### Quick start using PowerShell instead

Open two separate PowerShell windows at the extracted project root.

First time only:

```powershell
npm run install:all
Copy-Item server/.env.example server/.env
```

Terminal 1 — backend:

```powershell
npm run server
```

Terminal 2 — frontend:

```powershell
npm run client
```

Open `http://localhost:3000`.

## Frontend and backend

For local development, the Next.js frontend runs on `http://localhost:3000` and Express runs on `http://localhost:4000`. The browser uses relative `/api/*` URLs; the Next.js development server proxies API requests to Express. In production, Vercel serves the static Next.js export and runs Express as a serverless function at the same origin. Pusher Channels handles realtime messages, presence, and typing indicators; message mutations use the authenticated HTTP API.

The old Vite SSR mode remains opt-in for local experiments only and is not used by the production start command.

## Local URLs

- Frontend: `http://localhost:3000`
- Backend health check: `http://localhost:4000/api/health`
- Next.js proxies `/api` to the backend during local development.

A healthy response from `/api/health` should report `success: true` and database health `healthy`. The first backend start can take longer while its local database is initialized.

## Test and production-build checks

Run these from the project root while the backend is not necessarily running:

```powershell
npm test
npm run lint
npm run build
```

`npm test` runs the backend integration suite. `npm run build` checks/builds the frontend and compiles the backend into `server/dist/src/` for the unified production server. The current `lint` scripts run TypeScript checks; this repository does not include an ESLint configuration. To run only one check:

```powershell
npm run lint --prefix client
npm run lint --prefix server
npm run build --prefix client
npm run build --prefix server
```

The backend `build` script generates Prisma Client and emits JavaScript. The production start script applies committed PostgreSQL migrations with `prisma migrate deploy` before starting `client/server.mjs`.

## Optional providers

The core local server can start without external credentials. Some features need provider setup:

- Email verification and password reset email delivery: configure SMTP in `server/.env`. In development, the API can return a sandbox OTP when email delivery is not configured; do not use that behavior in production.
- Google sign-in: configure `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_CALLBACK_URL` in `server/.env`. Set `FRONTEND_PUBLIC_URL` to the frontend origin (locally `http://localhost:3000`; in deployment, the public frontend URL). This setting takes precedence over `CLIENT_URL`, `FRONTEND_URL`, and `APP_URL` for the OAuth result redirect. Set `GOOGLE_CALLBACK_URL` to the backend OAuth endpoint and register that exact URL with Google (locally, `http://localhost:4000/api/auth/google/callback`). The backend then redirects to the frontend's `/auth/google/callback`.
- Media attachments and avatars: configure the Cloudinary keys in `server/.env`.
- Production database: use a real PostgreSQL database (for example Neon), set `DATABASE_URL` to its pooled connection and `DIRECT_URL` to its direct connection.

### AI features and provider setup

The chat composer includes an AI Message Writer, AI sticker/avatar maker, audio upload transcription, and microphone transcription. AI output can be edited, copied, inserted in the composer, or sent with the existing chat send flow. Generated images can be downloaded or added as a staged chat attachment.

Copy `server/.env.example` to `server/.env`, then add provider keys there. On a deployment host, enter them as backend environment secrets. Never put these values in `client/.env*`, a `VITE_` variable, browser code, or frontend deployment settings.

AI environment variables in the example file:

| Variables | Purpose |
|---|---|
| `GEMINI_API_KEY`, `XAI_API_KEY`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `OPENROUTER_API_KEY` | Server-side credentials. Configure only the providers you intend to use. |
| `AI_ALLOW_PAID_USAGE` | Defaults to `false`; models not classified as free by the configured provider/catalog are excluded. |
| `AI_GEMINI_FREE_TIER_CONFIRMED`, `AI_GEMINI_IMAGE_FREE_TIER_CONFIRMED`, `AI_CLOUDFLARE_FREE_PLAN` | Operator confirmations required before those model sets can be considered free. Gemini text and image are gated separately. Set only after verifying account plan, model, and billing in the provider dashboard. |
| `GEMINI_TEXT_MODEL`, `GEMINI_IMAGE_MODEL`, `XAI_TEXT_MODEL`, `XAI_IMAGE_MODEL`, `CLOUDFLARE_TEXT_MODEL`, `CLOUDFLARE_IMAGE_MODEL`, `CLOUDFLARE_AUDIO_MODEL` | Optional model IDs. Use IDs supported by the corresponding provider/account. |
| `OPENROUTER_TEXT_MODEL`, `OPENROUTER_IMAGE_MODEL` | Optional preferences; text defaults to OpenRouter's live `openrouter/free` model and image has no free default. A preference is used only when the live catalog confirms support and the price policy allows it. Transcription models are discovered live. |
| `GEMINI_TIMEOUT`, `GEMINI_MAX_RETRIES`, `GEMINI_RETRY_DELAY`, `XAI_TIMEOUT`, `XAI_MAX_RETRIES`, `XAI_RETRY_DELAY`, `CLOUDFLARE_TIMEOUT`, `CLOUDFLARE_MAX_RETRIES`, `CLOUDFLARE_RETRY_DELAY`, `OPENROUTER_TIMEOUT`, `OPENROUTER_MAX_RETRIES`, `OPENROUTER_RETRY_DELAY` | Optional provider request controls; timeout and retry delay are milliseconds, retries are a bounded count. |

`AI_ALLOW_PAID_USAGE=false` is the default. With that setting:

- Gemini text is eligible only after setting `AI_GEMINI_FREE_TIER_CONFIRMED=true` and using a model/key/project whose current Google AI Studio plan permits free use. The default model is `gemini-3.8-flash`; change it with `GEMINI_TEXT_MODEL` after checking current model availability and your account tier.
- Gemini image generation uses Google's [Interactions API](https://ai.google.dev/gemini-api/docs/image-generation) and the `gemini-nano-banana-2.1` model by default. It remains ineligible with paid usage disabled unless `AI_GEMINI_IMAGE_FREE_TIER_CONFIRMED=true` is explicitly set after checking your Google account and the model's current pricing/availability. The image confirmation is separate from the text-model confirmation.
- Cloudflare models (text, image generation, and Whisper transcription) are eligible only after setting `AI_CLOUDFLARE_FREE_PLAN=true` and verifying the account is on Workers Free. Workers Free rejects inference after its daily free allocation; a Workers Paid account bills beyond its included allocation. The confirmation switch prevents this app from selecting Cloudflare models by default.
- xAI models are excluded because this configuration does not claim an xAI free tier; Grok image generation also requires account access to the configured image model. OpenRouter discovers text, image, and transcription models from its live catalog, verifies the requested capability, and excludes models with non-zero or unknown pricing. Image eligibility checks image-token and image-output prices as well as the generic image price; a `:free` model name alone is not treated as proof of zero cost. `OPENROUTER_TEXT_MODEL` and `OPENROUTER_IMAGE_MODEL` are preferences only; they are used only when the live catalog reports that capability and the model is eligible under the paid-usage setting.

These free-tier confirmation flags are operator assertions; they do not query account billing settings. The router reacts to quota and rate-limit errors, honors `Retry-After`, and temporarily skips failed providers per capability. Provider APIs do not expose a reliable, universal preflight check for remaining account quota or billing state, so confirm plan and billing settings in each provider dashboard. `AI_ALLOW_PAID_USAGE=false` prevents this app from selecting models it has classified as paid or whose pricing is unknown; it cannot override billing rules imposed by a provider on a key/account you have marked as free. Setting `AI_ALLOW_PAID_USAGE=true` allows paid models and can incur charges.

After signing in, `GET /api/ai/status` lists configured providers, currently eligible model capabilities, OpenRouter catalog discovery status, and per-capability cooldowns. It does not disclose keys or claim remaining quota. Input and output contents are not written to provider logs by ChatSphere. Capabilities are model-specific: Gemini is configured for text, xAI for text and its separate image model, Cloudflare for text/image/audio, and OpenRouter from its live catalog; a provider is skipped if its catalog/model does not support the requested operation.

If image generation returns `AI_UNAVAILABLE`, check `/api/ai/status` for an eligible image model. Adding a key does not make a paid model eligible while `AI_ALLOW_PAID_USAGE=false`; confirm free access for that specific image model before setting its free-tier confirmation flag. The app does not automatically enable paid image generation.

All feature endpoints require ChatSphere authentication and CSRF validation. Audio is limited to 10 MB and supported browser audio formats, then sent only to an eligible transcription provider. Image generation is sent only to a provider with an image output model. The user message writer sends only the specific instruction and draft text supplied in that feature.

#### Configure and deploy

1. Copy `server/.env.example` to `server/.env` for local development. Configure at least one provider key and, for free-only usage, the applicable free-tier confirmation switch after verifying your account plan.
2. Restart the server after changing AI environment variables. Check `/api/ai/status` while signed in to confirm which capabilities are eligible.
3. For deployment, add the same settings as backend secrets/environment variables on the server host. Do not add them to the Vite client build environment. Keep `AI_ALLOW_PAID_USAGE=false` unless you intentionally want billable requests.
4. Build and deploy the backend and frontend using the existing deployment instructions below. AI features do not require a database migration.

Never commit `server/.env`, `client/.env.local`, database files, passwords, API keys or signing secrets to GitHub.

## Deploying to Vercel

The root `vercel.json` builds the Next.js client as a static export, publishes its output from `client/out`, and routes requests to the SPA or `api/[...route].ts` serverless Express function on the same origin. Pusher Channels provides realtime messaging, presence, and typing; a hosted PostgreSQL database is required because the local PGlite database is not supported in serverless functions.

1. Import the GitHub repository into Vercel with the repository root as the project root. Vercel uses `npm run install:all` and `npm run build`.
2. Set the required production settings in Vercel. Generate distinct signing secrets of at least 32 characters:

   ```env
   NODE_ENV=production
   DATABASE_URL=<pooled PostgreSQL URL>
   DIRECT_URL=<direct PostgreSQL URL>
   JWT_ACCESS_SECRET=<unique random secret, at least 32 characters>
   JWT_REFRESH_SECRET=<different unique random secret, at least 32 characters>
   CSRF_SECRET=<different unique random secret, at least 32 characters>
   FRONTEND_PUBLIC_URL=https://<your-vercel-domain>
   COOKIE_SECURE=true
   COOKIE_SAME_SITE=lax
   PUSHER_APP_ID=<Pusher app id>
   PUSHER_KEY=<Pusher key>
   PUSHER_SECRET=<Pusher secret>
   PUSHER_CLUSTER=<Pusher cluster>
   VITE_PUSHER_KEY=<same public Pusher key>
   VITE_PUSHER_CLUSTER=<same Pusher cluster>
   ```

   Set `VITE_PUSHER_KEY` and `VITE_PUSHER_CLUSTER` for the Vercel build so Next.js exposes only the public key and cluster in browser code. Never expose `PUSHER_SECRET`, database credentials, or signing secrets as client variables.
3. Configure `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET` for email and media features. Google sign-in requires `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_CALLBACK_URL=https://<your-vercel-domain>/api/auth/google/callback`; register that exact URL with Google. Add optional web-push and AI provider variables as needed. Keep secrets in Vercel's server-side environment settings.
4. Ensure the hosted database supports connection pooling. The API caches its Prisma client for warm invocations and sets `connection_limit=1` on Vercel when the database URL does not already specify one. Apply committed Prisma migrations to the hosted database as a deployment step; serverless function invocations do not run migrations.
5. After deployment, check `https://<your-vercel-domain>/api/health`, then test sign-in, chat, presence/typing, uploads, notifications, and admin permissions.

## Troubleshooting

**`express` / other package not found** — run `INSTALL.bat` or `npm run install:all` from the project root. For local development, use `RUN-SERVER.bat` or `npm run server`; production starts with `npm start` after the build.

**Port already in use** — close the other development server first. Next.js frontend is `3000`, backend is `4000`.

**Frontend loads but API fails locally** — keep the backend terminal open and open `http://localhost:4000/api/health`. If that is unhealthy, resolve the backend/database error before testing the UI.

**OTP not arriving by email locally** — configure SMTP or check the development registration response for its sandbox OTP notice. Configure SMTP before going live.

**Build fails** — copy the full first error and the command you ran; do not delete `package-lock.json` or random config files as a workaround.
