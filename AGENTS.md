# AXIOM Reader: working instructions

This is an existing browser-based document reader. Start with CURRENT.md if present and the requested feature's source. Read ROADMAP.md for planning context and `axiom-design-system.md` for visible changes. Treat roadmap entries as plans, not proof that features are unfinished or complete.

- Preserve original documents, user notes, highlights, pronunciation settings, and locally stored data. Use synthetic documents for testing; do not clear browser storage to fix a problem without specific authorization.
- Inspect `index.html`, relevant files under `js/` and `css/`, and `sw.js` only as needed. The service worker supports installed/offline behavior; changes there require refresh and offline checks.
- This root has no package.json. Do not introduce a framework or installation step merely to preview it. Use an available static HTTP server bound to the local computer, verify the chosen port, and open the served page in Browser. For example, when Python is available, `python -m http.server 8000 --bind 127.0.0.1` from this folder serves it at `http://127.0.0.1:8000/`; use Ctrl+C to stop that owned process.
- Existing browser checks are at `tests/reader-check.html`, with a synthetic document and playback checks. Read their scripts before use and exercise affected reader behavior. Playback in a desktop browser does not prove mobile background audio works.
- Preserve unrelated changes. Publication requires the user's authorization.

## Verification and handoff

- For visible application changes, use the in-app Browser when available. Reuse its evidence; do not repeat the same check through another browser skill. Honor any browser-policy rejection without switching tools to bypass it.
- Match checks to the change: rendered appearance and relevant accessibility checks for visual work; the affected user journey and data behavior for functional work; documented release checks for publication. Static checks do not establish browser or production success.
- Re-run passed checks only when later changes or unresolved concerns justify it. Retain project-required release checks.
- At a meaningful handoff, update CURRENT.md with the date, requested objective, affected files, verification evidence, unresolved work, and next action. Do not overwrite another active task's status; use a separate task note and link it if needed. Do not label old reports as newly verified.
