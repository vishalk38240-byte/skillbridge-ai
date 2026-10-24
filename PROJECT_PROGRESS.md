# SkillBridge AI — Project Progress and Handoff

This document summarizes the current project so work can continue without losing context.

## Project overview

SkillBridge AI is a career support website for early-career and experienced job seekers. It helps users create a profile, explore career paths and mentors, compare their skills with job requirements, and use AI-powered career tools.

## Current project location

`C:\Users\visha\Documents\Codex\2026-10-23\i\work\skillbridge-run`

## What is implemented

- React + Vite single-page app with a dark blue career-workspace UI.
- Firebase authentication and profile storage when Firebase settings are provided.
- Local browser-based account/profile mode when Firebase settings are absent. This is useful for a local preview; it is not a production account system shared between devices.
- Profile editing and saving, including name, location, headline, overview, skills, education, experience/projects, career stage, target job, resume text, preferred work type, and additional information.
- Dashboard reflects the saved profile and profile completeness.
- Four sample profiles (product design, frontend engineering, digital marketing, and data analysis). The user advances to the next sample only by clicking the load-example button.
- Dashboard skill comparison. Sample profiles now carry clearly labeled fictional role requirements, so after loading and saving a sample, the dashboard can show a match percentage, progress line, and skill gaps even before a real job search.
- Real job search/matching flow. When successful, real listing requirements replace the sample preview.
- Career roadmaps, mentor/specialist recommendations, skill analysis, and career-news areas are part of the project UI.
- AI requests are routed through `api/ai.js`, keeping the Groq key server-side. Chat uses GPT-OSS 20B; job and industry-news lookups use Groq browser search with the same model.

## Most recent fix

The dashboard previously showed no skill-match progress for any loaded sample because sample data had no requirement list to compare against. `src/App.tsx` now includes fictional requirements per sample, calculates a sample match only when there are no real matched jobs, labels the preview as fictional, and clears that preview after real matching results are saved.

The latest production build completed successfully with Vite. The build reports a large-chunk advisory; it does not fail the build.

## Run locally

From the project folder:

1. Install dependencies with `pnpm install` (or `npm install` if using npm).
2. Start the development site with `pnpm dev` (or `npm run dev`).
3. Open the local URL printed by Vite. The current configuration binds to `127.0.0.1`.
4. To create a production build, run `pnpm build` (or `npm run build`).

## Environment and deployment

- `.env.example` documents the environment variables.
- `GROQ_API_KEY` is required for server-side AI features. Configure it in the local environment or the deployment provider's server-side environment settings. Never put this key in a `VITE_` variable or commit a real key.
- Firebase variables in `.env.example` are optional for local UI preview, but must be configured for Firebase-backed accounts and cloud profile storage.
- `.env.local` is intentionally ignored by Git. Do not share it or include it in a handoff archive because it may contain secrets.
- `api/ai.js` is a serverless endpoint intended for deployment environments that support the Vercel API route. AI features require that endpoint and a valid Groq key.
- Local development with the Vite server alone may not run the Vercel serverless API route. If AI calls fail locally, use the Vercel development runtime or deploy the project with the environment variables configured.

## Key files

- `src/App.tsx` — application UI, dashboard, sample profiles, profile form, job matching and app flow.
- `src/index.css` — global styles and animations.
- `api/ai.js` — server-side Groq endpoint.
- `index.html` — Vite page entry.
- `package.json` — dependencies and scripts.
- `.env.example` — names of supported environment variables; values are blank placeholders.

## Recommended next steps

1. Preview the app and confirm sample load → save profile → dashboard progress behavior.
2. Set up Firebase if accounts and profiles need to persist across browsers/devices.
3. Set `GROQ_API_KEY` in the deployment environment and verify the serverless AI endpoint there.
4. Deploy to Vercel and verify authentication, profile persistence, job matching, and AI features with real configuration.
5. Consider splitting the large frontend bundle if production load performance needs improvement.

## Handoff note for another AI or developer

Continue from this existing Vite + React project. Preserve its current visual design and working feature flows. Before changing behavior, inspect `src/App.tsx` and the existing API endpoint. Keep secrets out of client code and out of shared files. The sample skill requirements are fictional preview data and must remain visibly distinguished from live employer listings.
