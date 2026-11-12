# ChatSphere — Clean Full-Stack Project

ChatSphere is split into one frontend and one backend so you do not have to deal with duplicate `src` folders or run the wrong `server.ts` file.

## Folder structure

```text
ChatSphere/
├── client/                  Next.js + React + TypeScript + Tailwind/DaisyUI
│   ├── public/images/       Landing page images
│   ├── src/
│   │   ├── components/     Reusable UI
│   │   ├── context/        Auth, navigation and Socket.IO state
│   │   ├── lib/api.ts      API client, CSRF and media uploader
│   │   ├── app/            Next.js routes
│   │   ├── views/          Landing, auth, chat, profile, admin screens
│   │   ├── types/          Frontend types
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── package.json
│   ├── next.config.ts
│   └── .env.example
├── server/                  Express + Socket.IO + Prisma backend
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
│   │   ├── socket/          Socket.IO events
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

The Next.js frontend lives in `client`; Express, Socket.IO and Prisma live in `server`. The root-level Vite config is not the production frontend configuration.

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

The Next.js frontend runs on `http://localhost:3000`; Express and Socket.IO run on `http://localhost:4000`. In production, deploy these as separate services: Next.js serves the website, while Express serves the API and Socket.IO. Express does not try to load a Vite SSR bundle in production.

The old Vite SSR mode remains opt-in for local experiments only. It is not part of the recommended production deployment.

## Local URLs

- Frontend: `http://localhost:3000`
- Backend health check: `http://localhost:4000/api/health`
- Next.js proxies `/api` and `/socket.io` to the backend during local development.

A healthy response from `/api/health` should report `success: true` and database health `healthy`. The first backend start can take longer while its local database is initialized.

## Test and production-build checks

Run these from the project root while the backend is not necessarily running:

```powershell
npm test
npm run lint
npm run build
```

`npm test` runs the backend integration suite. `npm run build` checks the frontend TypeScript/build and compiles the backend into `server/dist/src/index.js`. The current `lint` scripts run TypeScript checks; this repository does not include an ESLint configuration. To run only one check:

```powershell
npm run lint --prefix client
npm run lint --prefix server
npm run build --prefix client
npm run build --prefix server
```

The backend `build` script explicitly emits JavaScript. This fixes the old backend setting where TypeScript had `noEmit: true` even though the production start command expected `dist/src/index.js`.

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

## Deploying after local testing

### Recommended low-cost deployment: Vercel + Render + Neon

This app uses httpOnly cookies for authentication and a persistent Socket.IO connection. The simplest reliable layout is one Next.js site, one always-running Express service, and one managed PostgreSQL database. Free service quotas and sleep/usage limits can change; check each provider's current plan before launch. A custom domain under your control is recommended for reliable cross-subdomain cookies and may have a separate registration cost.

1. Push the project root to GitHub. Do not commit any `.env` file.
2. Create a PostgreSQL database on Neon. Copy its pooled connection string to the backend's `DATABASE_URL`, and its direct connection string to `DIRECT_URL`. Keep both private.
3. On Render, create a Blueprint from the same GitHub repository and use the root-level `render.yaml`. It defines a Node 22 web service rooted at `server`, builds the Prisma client and backend, runs migrations before startup, and checks `/api/health`. Add the Neon pooled URL as `DATABASE_URL`, the direct URL as `DIRECT_URL`, and set `FRONTEND_PUBLIC_URL` and `CORS_ALLOWED_ORIGINS` to your exact frontend origin. Render generates the three signing secrets. Add any optional provider credentials (Google, SMTP, Cloudinary, AI) in Render's backend environment settings only. Render supplies `PORT`.
4. On Vercel, import the same repository and set the **Root Directory** to `client`. Select Next.js (normally autodetected) and use `npm run build`. Add these environment variables, replacing the example host with your backend URL:

   ```env
   NEXT_PUBLIC_API_URL=https://YOUR_API_HOST/api
   NEXT_PUBLIC_SOCKET_URL=https://YOUR_API_HOST
   API_BACKEND_ORIGIN=https://YOUR_API_HOST
   ```

   The `NEXT_PUBLIC_*` values are public, not secrets. `API_BACKEND_ORIGIN` is used by Next.js rewrites, including the OAuth callback alias. Redeploy after changing any of these values.
5. For reliable authentication cookies, use custom subdomains under the **same parent domain**, for example `app.example.com` and `api.example.com`. Configure Render with `FRONTEND_PUBLIC_URL=https://app.example.com`, `CORS_ALLOWED_ORIGINS=https://app.example.com`, `COOKIE_DOMAIN=.example.com`, `COOKIE_SECURE=true`, and `COOKIE_SAME_SITE=lax`. Point all three Vercel URLs above at `https://api.example.com`. Add any separate admin frontend origin to `CORS_ALLOWED_ORIGINS` too. For a no-custom-domain trial, use the exact Vercel URL in `FRONTEND_PUBLIC_URL` and `CORS_ALLOWED_ORIGINS`, keep `COOKIE_SECURE=true`, `COOKIE_SAME_SITE=none`, and leave `COOKIE_DOMAIN` unset. This cross-site cookie setup may fail in browsers that block third-party cookies, so test registration/login before sharing the site.
6. If using Google sign-in, set `GOOGLE_CALLBACK_URL` to `https://YOUR_API_HOST/api/auth/google/callback` and register that exact callback URL with Google. Configure SMTP for verification/reset emails and Cloudinary for media; without them those features are unavailable. Keep paid AI usage disabled unless you intentionally accept provider charges.
7. After deployment, open `https://YOUR_API_HOST/api/health` and confirm the database is healthy. Then test registration, verification, login/logout, chat and Socket.IO, uploads, and admin permissions. Admin pages may be deployed separately later, but backend `ADMIN` role checks must remain enabled.

Do not use the local embedded PostgreSQL database for live data. Hosting accounts, provider credentials, and custom-domain setup must be configured by you; never put backend secrets in Vercel's frontend environment.

## Troubleshooting

**`express` / other package not found** — run `INSTALL.bat` or `npm run install:all` from the project root. Do not run `node server.ts`; that old combined entry point has been removed. Use `RUN-SERVER.bat` or `npm run server`.

**Port already in use** — close the other development server first. Next.js frontend is `3000`, backend is `4000`.

**Frontend loads but API fails** — keep the backend terminal open and open `http://localhost:4000/api/health`. If that is unhealthy, resolve the backend/database error before testing the UI.

**OTP not arriving by email locally** — configure SMTP or check the development registration response for its sandbox OTP notice. Configure SMTP before going live.

**Build fails** — copy the full first error and the command you ran; do not delete `package-lock.json` or random config files as a workaround.
