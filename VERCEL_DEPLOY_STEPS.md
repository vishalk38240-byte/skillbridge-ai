# Deploy SkillBridge AI to Vercel

This guide publishes the project to a hosted `*.vercel.app` address so it does not depend on your computer or a local terminal staying open.

## Files in this download

- `src/` — the website
- `api/ai.js` — the server-side Groq API endpoint
- `package.json` and lockfiles — app dependencies and build scripts
- `.env.example` — the environment variable names only (no secret values)
- `PROJECT_PROGRESS.md` — project handoff notes

The archive intentionally omits `node_modules/`, `.pnpm-store/`, and `.env.local`. Do not upload or share a real `.env.local` file; it can contain private keys.

## Before you begin

You need a GitHub account, a Vercel account, and Node.js installed on your computer. To enable AI, create an API key at https://console.groq.com/keys. For real cloud login and saved profiles, you need a Firebase project.

## Step 1 — Extract the project

1. Download `SkillBridge-AI-Deploy.zip` and extract it.
2. Open the extracted `SkillBridge-AI-Project` folder.
3. In File Explorer, click the address bar, type `powershell`, and press Enter. This opens a terminal in that folder.

## Step 2 — Check the project locally

Run these commands one at a time:

```powershell
npm install
npm run build
```

The second command should finish with a successful Vite build. If Windows says `npm` is not recognized, install the current Node.js LTS release, close and reopen PowerShell, then retry.

## Step 3 — Create a Vercel project from this folder

In the same PowerShell window, run:

```powershell
npm install --global vercel
vercel login
vercel
```

Sign in in the browser when asked. When Vercel asks to set up the folder, confirm the project and use these build settings if prompted:

- Framework preset: `Vite`
- Build command: `npm run build`
- Output directory: `dist`
- Root directory: `./`

The first `vercel` command creates a preview deployment and links this folder to the Vercel project.

## Step 4 — Add the API key and optional Firebase settings

Open [vercel.com/dashboard](https://vercel.com/dashboard), select the new project, then go to **Settings → Environment Variables**.

Add these variables as needed:

- `GROQ_API_KEY` — your Groq API key. Keep this name exactly; never add a `VITE_` prefix.
- For Firebase-backed accounts and cloud-saved profiles, add all six values from `.env.example`: `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, and `VITE_FIREBASE_APP_ID`.

Choose the **Production** environment (and **Preview** too if you want preview deployments to use the same services). Enter the real values in Vercel’s dashboard, not in this guide or a shared ZIP.

If you enable Firebase Authentication, add your Vercel domain (for example, `your-project.vercel.app`) to Firebase Authentication’s **Authorized domains**.

## Step 5 — Publish the production site

Back in PowerShell, run:

```powershell
vercel --prod
```

Vercel will print the production URL. Open that URL from any device. Your computer can be turned off; Vercel hosts the site.

## Updating the website later

After changing files in this folder, run `vercel --prod` again. If you change environment variables in Vercel, redeploy afterward so the new values take effect.

## What works without optional services

The public website can deploy without Firebase or Groq configuration. Without Groq, AI features will show an API configuration error. Without Firebase, sign-in/profile behavior uses browser-local demo storage and is not a shared, cloud-backed account. Add the corresponding environment variables and redeploy to enable those services.

## Official guides

- [Vercel: Vite projects](https://vercel.com/docs/frameworks/frontend/vite)
- [Vercel: environment variables](https://vercel.com/docs/environment-variables)
