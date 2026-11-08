<div align="center">

# ChatLens

**Upload a WhatsApp chat export and get chat statistics plus an AI-written relationship report.**

![Status](https://img.shields.io/badge/status-beta-d29922?style=flat-square&labelColor=0d1117)
![AI providers](https://img.shields.io/badge/AI-Gemini%20%7C%20Claude%20%7C%20OpenRouter-1f6feb?style=flat-square&labelColor=0d1117)

</div>

---

## Overview

ChatLens is a web app that turns an exported WhatsApp chat into insights. You upload the export (`.txt` or `.zip`) and get:

1. **Exact stats**: who texts more, who starts conversations, reply speed, active hours, streaks, emojis and favourite words. These are calculated in the browser.
2. **An AI-written read on the relationship** from Gemini, Claude or OpenRouter, sent through a Supabase Edge Function.

Built with HTML, CSS and vanilla JavaScript, plus one Supabase Edge Function. There's no build step and no framework.

> **Status: beta.** The stats work fully in the browser. The AI report passes its tests with a simulated AI and is waiting on a real AI key before it's used live. The site isn't publicly hosted yet.

## Problem Statement

Group and personal chats hold years of conversation, but there's no easy way to see patterns in them: who talks most, when people are active, how the tone has changed. ChatLens makes those patterns visible and adds an AI summary that puts them into words.

## How it works

```
Browser                                              Supabase Edge Function          AI
──────────────────────────────────────────────       ───────────────────────         ──────────
.txt/.zip ─► parser.js ─► stats.js ─► charts (all local)
                    │
                    └─► report.js: rename people to "Person A/B",
                        remove phones/emails/links,
                        sample ~150k chars across the timeline ──► analyze ──(API key)──► Gemini / Claude / OpenRouter
                                                                       │
   real names put back in the browser ◄─── JSON report ◄───────────────┘   (nothing is stored)
```

| File | Job |
|---|---|
| `js/parser.js` | Reads Android and iPhone export formats: multi-line messages, system lines, media, deleted messages, calls, 12h or 24h time, and any date order |
| `js/stats.js` | All the numbers. A new conversation starts after 6 hours of silence. Reply time is the gap until the other person answers. A double text is a second message after 20+ minutes with no reply |
| `js/charts.js` | Small bar charts built from divs, with tooltips |
| `js/report.js` | Anonymises the chat, picks a sample to fit the budget, calls the function, then puts real names back |
| `js/app.js` | Connects the page together |
| `js/sample.js` | Fake chat generator for testing |
| `supabase/functions/analyze/prompt.ts` | **The AI's personality and the report format. Edit this to change the voice.** |
| `supabase/functions/analyze/handler.ts` | Provider calls, CORS, rate limit, size limits |

---

## Phase 1: stats only (no backend)

1. Open the folder in VS Code and start **Live Server** (or just double-click `index.html`).
2. Click **Try with a sample chat**. You should see the stats page.
3. Export a real chat (WhatsApp → chat → ⋮ → More → Export chat → *Without media*) and upload it.

✅ Check: the message counts match what you'd expect, and dates and times look right.

## Phase 2: deploy the edge function

You need the [Supabase CLI](https://supabase.com/docs/guides/cli) and a Supabase project.

```bash
npx supabase login

# add the API keys you have (one is enough)
npx supabase secrets set GEMINI_API_KEY=...     --project-ref YOUR_PROJECT_REF   # https://aistudio.google.com/apikey
npx supabase secrets set ANTHROPIC_API_KEY=...  --project-ref YOUR_PROJECT_REF   # https://console.anthropic.com
npx supabase secrets set OPENROUTER_API_KEY=... --project-ref YOUR_PROJECT_REF   # https://openrouter.ai/keys

npx supabase functions deploy analyze --no-verify-jwt --use-api --project-ref YOUR_PROJECT_REF
```

`--no-verify-jwt` is needed because visitors aren't logged in. The browser sends only your **publishable key**, and the function does its own protection (see Security).

✅ Check: open `https://YOUR_PROJECT_REF.supabase.co/functions/v1/analyze` in a browser. It should show `{"providers":["gemini", ...]}`.

## Phase 3: connect the front end

Edit `js/config.js`:

```js
SUPABASE_URL: 'https://YOUR_PROJECT_REF.supabase.co',
SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_...',
```

The publishable key is public by design, so it's fine in the repo. Never put AI keys here.

Reload the page, load a chat, pick a provider and click **Write my report**.

✅ Check: the dropdown lists only the providers you added keys for, and the report shows real names (they're swapped back in the browser).

## Changing models

The defaults are `gemini-3.8-flash`, `claude-sonnet-5-5` and `google/gemini-3.8-flash` (OpenRouter). You can override any of them without changing code:

```bash
npx supabase secrets set ANTHROPIC_MODEL=claude-haiku-5-5 --project-ref YOUR_PROJECT_REF   # cheaper
npx supabase secrets set GEMINI_MODEL=gemini-3.5-flash-lite --project-ref YOUR_PROJECT_REF
```

Rough cost per report with the default 150k-character sample (about 40–60k tokens in): around $0.13 (about ₹11) on Claude Sonnet 5.5, less on Haiku, and usually less on Gemini Flash. Check each provider's pricing page for current rates. Lower `TRANSCRIPT_CHAR_BUDGET` in `config.js` to spend less.

## Security and privacy (read before sharing the link)

- **Lock it to your site.** Once it's hosted, run `npx supabase secrets set ALLOWED_ORIGINS=https://your-site.com --project-ref YOUR_PROJECT_REF`. Without this, anyone can call your function and use up your API credit.
- There's a basic limit of 10 reports per IP per hour (`REPORTS_PER_HOUR_PER_IP`). It lives in memory, so it resets when the function restarts. For real traffic, add Supabase Auth (log in to generate a report) or a rate-limit table.
- Chats are never stored. The function only holds them in memory for the length of one request. Don't add `console.log(body)`, because Supabase keeps function logs.
- Anonymising is on by default. Names inside messages are replaced only when they match the contact names, so nicknames still get through.
- A chat includes another person's messages. Tell your users to only upload chats they're part of.
- API keys and other secrets are kept in Supabase secrets and never committed to this repository (see `.gitignore`).

## Tests

```bash
node tests/test-parser-stats.js                         # parser + stats (Android, iPhone, US, German formats)
node tests/test-report.js                               # anonymiser + sampling
node --experimental-strip-types tests/e2e.mjs ./out     # full page in a browser with a fake AI (needs Playwright)
```

For the e2e test, set `PW_CHANNEL=msedge` (or `chrome`) to use an installed browser instead of Playwright's own Chromium.

## Ideas for next steps

- Shareable report link: save the report (never the chat) to a `reports` table with RLS.
- iMessage or Telegram parsers: add one to `parser.js` that returns the same `{date, sender, text, type}` shape.
- "Compare two time periods" to answer *what changed*.
- Language setting: pass the user's language in `meta` and add a line about it in `prompt.ts`.

## Author

**Mohammed Shamsul Qhadri Shareef**
GitHub: [@MohammedShareef3527](https://github.com/MohammedShareef3527)
