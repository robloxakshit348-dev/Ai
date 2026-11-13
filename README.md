# OmniAI

Free AI chat, coding assistant, document analysis and image-prompt studio in one beautiful workspace.
**No database.** Uses only OpenRouter **free models**. Two ways to host the same site:

| Host | Backend | Best for |
|---|---|---|
| **Render** (recommended) | Node.js + Express (`server.js`) | Reliable, auto-deploys from GitHub, free plan |
| **InfinityFree** | PHP (`php/`) | Classic shared hosting |

```
public/   shared frontend (HTML, CSS, JS, prompts.json)
server.js, ai.js, limits.js   Express backend for Render
php/      PHP backend for InfinityFree
test/     tests (mock OpenRouter)      scripts/  build helper
```

## Publish in 10 minutes

### A. Put the code on GitHub
1. Create an empty repository at https://github.com/new (name it `omniai`, no README).
2. Unzip `OmniAI-GitHub-Render-Express.zip`, open a terminal inside the `omniai-express-render` folder and run:
   ```bash
   git init
   git add .
   git commit -m "OmniAI"
   git branch -M main
   git remote add origin https://github.com/YOUR_NAME/omniai.git
   git push -u origin main
   ```
3. Check on GitHub that no `.env` file or real API key was uploaded (`.gitignore` blocks them).

### B. Deploy on Render
1. Sign in at https://render.com with GitHub.
2. **New +** → **Blueprint** → choose your `omniai` repo → **Apply**. (It reads `render.yaml`.)
3. Paste `OPENROUTER_API_KEY` when asked (or leave it empty to use only the keyless backup AI).
4. Wait for the first build to finish (a few minutes). Open the `https://omniai-xxxx.onrender.com` link.
5. Verify: `/healthz` shows `{"ok":true}`, then send one chat message.
6. Updating later: `git push` redeploys automatically. Optional: **Settings → Custom Domains** to use your own domain.

### C. (Optional) Deploy on InfinityFree instead
1. Use the ready folder from `OmniAI-InfinityFree-PHP.zip` (or run `npm run build:infinityfree`).
2. Open `config.php`, replace `PASTE_YOUR_OPENROUTER_API_KEY_HERE` with your key (or leave it to use the backup AI).
3. In the InfinityFree File Manager (or FTP) open `htdocs/`, delete the default `index2.html`, and upload the **contents** of the folder (including the `.htaccess` file and the `storage` folder).
4. Visit your site. To troubleshoot, set `diagnose_token` in `config.php`, open `diagnose.php?token=YOUR_TOKEN`, then **delete `diagnose.php`**.

### Final checklist
- [ ] Key only in Render env vars / `config.php` / `config.local.php`, never in Git or JavaScript
- [ ] One chat message works; "Image Studio", "Documents" and "AI Coding" each return an answer
- [ ] Phone view shows the bottom tab bar; light/dark toggle works
- [ ] If a key ever leaks, delete it at https://openrouter.ai/keys and create a new one

## 1. Get an OpenRouter key (free)
Create a key at https://openrouter.ai/keys. Free models cost nothing, but are rate limited (about 20 requests/minute and a daily cap that is higher once you have bought a small amount of credits). The limit belongs to your **OpenRouter account**, not to the host.

**Out of credits or rate-limited?** Add a spare key from another OpenRouter account (`OPENROUTER_API_KEYS` on Render, `api_keys` in `php/config.php`). Both backends switch to the next key automatically on "out of credits" or "rate limited" errors, and also fall back to the next free model.

## Works even without a key or credits (backup AI)
If OpenRouter has **no key**, is **out of credits**, or is **rate-limited**, both backends automatically fall back to a **keyless public AI endpoint** (Pollinations, `https://text.pollinations.ai/openai`). Visitors then still get answers with nothing to configure, and a one-time notice tells them the backup AI answered.
Please know the trade-offs: it is a third-party community service, so it can be slow, rate-limited (anonymous use is about one request every 15 seconds) or go offline; answer quality varies; and prompts are sent to that service. Chat and AI Coding use it; image generation (`OPENROUTER_IMAGE_MODEL`) does not.
Turn it off with `KEYLESS_FALLBACK=false` (Render) or `'fallback' => ['enabled' => false]` (PHP). Change the endpoint with `FALLBACK_URL` / `FALLBACK_MODEL`.

## 2. Push to GitHub
```bash
git init && git add . && git commit -m "OmniAI"
git branch -M main
git remote add origin https://github.com/YOUR_NAME/omniai.git
git push -u origin main
```
`.gitignore` already excludes `.env` and `php/config.local.php`. **Never commit your API key.**

## 3a. Deploy on Render (Express)
1. Render dashboard → **New +** → **Blueprint** → pick your GitHub repo (it reads `render.yaml`).
   (Or **New + → Web Service**: build `npm install --omit=dev`, start `npm start`, health check `/healthz`.)
2. When asked, paste `OPENROUTER_API_KEY` (you can leave it empty to run only on the backup AI). Click **Apply**.
3. Open the `https://omniai-xxxx.onrender.com` URL. Every `git push` redeploys automatically.

Environment variables (all optional except the key):

| Variable | Default | Purpose |
|---|---|---|
| `OPENROUTER_API_KEY` | – | your key (optional: the site also runs on the keyless backup AI) |
| `OPENROUTER_API_KEYS` | – | spare keys, comma-separated |
| `OPENROUTER_MODELS` | `nvidia/nemotron-3-ultra-550b-a55b:free,openrouter/free` | free models, tried in order |
| `OPENROUTER_CODE_MODELS` | same as above | models for AI Coding |
| `OPENROUTER_IMAGE_MODEL` | empty | set only if you have an image model that is free for you |
| `DAILY_FREE_MESSAGES` | `30` | requests per visitor per day |
| `KEYLESS_FALLBACK` | `true` | backup AI that needs no key |
| `FALLBACK_URL` / `FALLBACK_MODEL` | Pollinations / `openai` | backup endpoint |

Render free plan notes: the service sleeps after ~15 minutes without traffic, so the first visit after a nap takes up to a minute to wake. Visitor limits are kept in memory and reset when the service restarts.

Run locally: `npm install && OPENROUTER_API_KEY=sk-or-... npm start` → http://localhost:3000. Tests: `npm test`.

## 3b. Deploy on InfinityFree (PHP)
```bash
npm run build:infinityfree      # creates dist/infinityfree/
```
(or download the ready-made `OmniAI-InfinityFree-PHP.zip`). Put your key in `config.php`, then upload the **contents** of that folder into `htdocs/`. Needs PHP 7.4+ with cURL.
To check problems, set `diagnose_token` in `config.php`, open `diagnose.php?token=YOUR_TOKEN`, then delete `diagnose.php`.

## Features
Chat with memory of the conversation · AI Coding with copy-ready code blocks · Document AI (.txt/.md, read in the browser) · Image Studio (polished prompts; optional real image model) · Prompt Library with your own saved prompts · light/dark theme · mobile tab bar.
Chat history and saved prompts live in the visitor's own browser, not on the server.

## Notes
- Free AI endpoints may log prompts and can make mistakes; tell visitors not to share private data.
- Visitor accounts, shared community prompts and paid plans need a database, so they are intentionally not included.
