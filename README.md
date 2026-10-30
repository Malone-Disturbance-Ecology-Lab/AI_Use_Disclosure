# AI_Use_Disclosure

A web app that surveys authors and produces a clear, specific **AI use disclosure statement** for papers, proposals, theses, software, and other projects. It separates what *you* contributed (ideas, prompts, data, code, text) from what the AI did, and says plainly what you did and did not verify.

It runs entirely in the browser from GitHub Pages. There is no server and no database.

## How it works

1. **Project**: title, type of work, voice (I/we), format, length, and optionally the venue's AI policy.
2. **AI tools**: name, model/version, provider, how it was accessed, and when.
3. **Prompts & inputs**: how you directed the AI, your own description of your prompts, and what material of yours (text, code, data, papers, figures) you gave it.
4. **Contributions**: for each area (ideas/design, literature, data, code, analysis, text, figures), the level of AI involvement, what the AI did, and what you did.
5. **Verification**: for each area where AI was used, how thoroughly you verified the output, how you did it, and what you did **not** verify.
6. **Data & responsibility**: confidential data, AI-suggested references, authorship, and a responsibility statement.
7. **Statement**: a draft built from a template using only your answers, with warnings about gaps. Then a chatbot polishes it:
   - **Option A:** chat in the page with your own Anthropic API key. The key is kept only in memory.
   - **Option B:** copy a ready-made prompt and paste it into any chatbot (Claude.ai, ChatGPT, or your institution's approved tool).

The chatbot is told to use only facts from the survey and never invent tools, uses, or verification steps. It also lists any gaps it finds.

## Privacy: nothing is stored

- Answers live only in the open browser tab. The app uses no cookies, `localStorage`, accounts, or analytics, and makes no server-side requests.
- **Erase everything & start over** clears every answer, the chat, and the API key, and empties the clipboard. Closing the tab does the same. Back/forward cache restores are also erased.
- A Content-Security-Policy limits network access to `api.anthropic.com`. That request is made only if you enter a key and press Send. Your answers then go to Anthropic under your own API account terms.

## Deploy on GitHub Pages

1. Push `index.html`, `app.js`, `styles.css`, and `.nojekyll` to the repository root (or to `/docs`).
2. Go to **Settings → Pages → Build and deployment** and set **Source: Deploy from a branch** with **Branch: `main`**, folder `/ (root)` (or `/docs`).
3. The app will be live at `https://<user-or-org>.github.io/AI_Use_Disclosure/`.

To run it locally, open `index.html` in a browser, or run `python -m http.server` and visit `http://localhost:8000`.

## Customizing

- Areas of contribution, roles, and verification methods are defined in arrays at the top of `app.js` (`AREAS`, `ROLES`, `VERIFY_METHODS`).
- Instructions to the chatbot are in `SYSTEM_PROMPT` in `app.js`.
- The default model is set in `index.html` (`#model`).
