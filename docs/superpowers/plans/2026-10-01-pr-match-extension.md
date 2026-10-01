# PR Match extension implementation plan

> **For agentic workers:** This plan is being executed inline with the user's explicit request. Tasks use checkbox syntax to track work.

**Goal:** Build a loadable Chrome extension with a local demo, pinned GitHub project dashboard, cross-repository PR review queue, and keyboard merge flow.

**Architecture:** A Manifest V3 toolbar action opens a Vite-built React page. The service worker manages the extension tab and trusted GitHub requests; small domain functions calculate metrics, filter status, and merge readiness. Chrome local storage holds tokens, connections, pins, and settings; session storage holds short-lived GitHub responses and recoverable merge metadata.

**Tech Stack:** TypeScript strict mode, React, Vite, Chrome MV3 APIs, Vitest for domain tests.

**Spec:** `docs/superpowers/specs/2026-10-01-pr-match-design.md`

## Global constraints

- Dashboard is the opening view; PR review has its own view.
- Queue includes all open PRs in connected repositories, by all authors. Pins do not constrain queue coverage.
- Left arrow skips; right arrow merges without a confirmation dialog.
- All CI passing checks both current check runs and commit statuses. Unknown and missing results do not pass.
- Merge request uses the displayed head SHA and never bypasses repository rules.
- No backend, content scripts, remote executable code, or token logging.
- Include an offline demo mode so the built UI can be tried without credentials. Demo actions never call GitHub or simulate a real merge.
- Provide a Markdown guide for building, loading, and trying the unpacked extension in Chrome.

## Review focus

1. **Token handling:** tokens stay in trusted extension storage and never enter logs or rendered error text.
2. **Merge action races:** a changed SHA, repeated key, competing tab, or unresolved request cannot blindly submit another merge.
3. **CI completeness:** check runs and commit statuses both participate; partial, failed, neutral, and missing access never pass.
4. **Metric correctness:** PRs do not count as issues; a closed PR is not counted as merged; local-day boundaries are correct.
5. **Deployment correctness:** preview, stale success, inactive status, or build-log URLs are not labeled as the current production link.

---

## Planned files

- `package.json`, `package-lock.json`, `tsconfig.json`, `tsconfig.node.json`, and `vite.config.ts`: React/Vite build, type checking, tests, and extension output.
- `index.html`, `public/manifest.json`, `public/icon.svg`, `src/background.ts`: extension entry points and MV3 toolbar behavior.
- `src/domain/types.ts`, `src/domain/filters.ts`, `src/domain/metrics.ts`, `src/domain/filters.test.ts`, `src/domain/metrics.test.ts`: API view types and independently testable decisions.
- `src/github/client.ts`, `src/github/queries.ts`, `src/github/service.ts`: authenticated transport, pagination, and normalized GitHub reads/mutations.
- `src/storage/settings.ts`, `src/storage/cache.ts`: local configuration/credentials and session response cache.
- `src/main.tsx`, `src/App.tsx`, `src/styles.css`: error boundary, dashboard, queue, settings, and visual system.
- `docs/chrome-extension-testing.md`: prerequisites, production build, unpacked installation, demo walkthrough, live connection setup, keyboard checks, and reload cycle.

## Tasks

### Task 1: Create the extension shell

**Files:** package/config files, `index.html`, `public/manifest.json`, `public/icon.svg`, `src/main.tsx`, `src/background.ts`, and `src/styles.css`.

- [ ] Create a Vite React TypeScript project with strict type checking, `build`, `typecheck`, and `test` scripts.
- [ ] Configure Vite to emit a static app and standalone service worker to `dist/`, with relative asset URLs and no inline script.
- [ ] Add an MV3 manifest with the toolbar action, service worker, `storage` and narrowly scoped GitHub API host permission, and extension-page CSP.
- [ ] Make toolbar activation focus an existing extension tab or open the dashboard page.
- [ ] Add responsive navigation and a polished placeholder for Projects, Review, and Settings; add an unmistakable Demo mode badge.
- [ ] Run `npm run typecheck` and `npm run build`; inspect `dist/manifest.json` and the referenced output files.

### Task 2: Add local connections and GitHub API boundaries

**Files:** `src/domain/types.ts`, `src/github/client.ts`, `src/github/queries.ts`, `src/github/service.ts`, `src/storage/settings.ts`, `src/storage/cache.ts`, and settings components.

- [ ] Define typed repository, pull request, check, issue, deployment, connection, pin, filter, and merge-operation values. Represent unavailable and partial data explicitly.
- [ ] Add domain tests first for CI aggregation and merge eligibility. Run them red, implement the smallest pure helpers, then run them green.
- [ ] Implement worker messages for token validation and GitHub API requests. Allow only relative GitHub API paths, expected HTTP methods, and connection IDs. Attach tokens only inside the worker.
- [ ] Validate returned JSON before mapping it. Follow pagination only through validated `api.github.com` URLs, limit concurrency, respect rate limits, and normalize permission/network failures without copying tokens or raw payloads into errors.
- [ ] Add token settings for multiple resource-owner connections belonging to the same GitHub user. Test a token with `/user` before saving it. Allow remove/replace and clear connection-scoped cache.
- [ ] Store credentials and settings in `chrome.storage.local`; keep API response cache in session storage with stale-after-five-minutes behavior.
- [ ] Test the API boundary with mocked fetch responses for invalid tokens, missing permissions, pagination, partial results, and rate-limit headers.

### Task 3: Implement project dashboard data and pins

**Files:** `src/domain/metrics.ts`, `src/github/service.ts`, `src/storage/settings.ts`, dashboard views in `src/App.tsx`, and `src/domain/metrics.test.ts`.

- [ ] Implement local-day boundaries and merged-today counting by `merged_at`; test ordinary days and daylight-saving transitions.
- [ ] Implement open-issue totals that exclude PR records; test mixed issues/PRs and incomplete pagination.
- [ ] Load repositories available through each connected token, deduplicate by stable repository ID, and pin/reorder/unpin from the repository picker.
- [ ] Load open PR count and merged-today count per pinned repository with paginated, rate-limited reads.
- [ ] Resolve a deployment link from deployment status history; filter production environments, prefer latest successful status by status time, reject invalid or stale links, and support per-pin environment choice and HTTPS override.
- [ ] Render independent card loading/errors, stale timestamps, no deployment states, and Review navigation scoped to a selected repository.
- [ ] Add static demo fixtures and ensure Demo mode uses no GitHub requests or merge mutations.

### Task 4: Implement the keyboard PR queue and guarded merge

**Files:** `src/github/service.ts`, `src/domain/filters.ts`, review views in `src/App.tsx`, `src/background.ts`, and `src/styles.css`.

- [ ] Load open PRs across all connected repositories and authors, deduplicate by PR ID, order by oldest creation time, and keep the visible card stable while later results arrive.
- [ ] Hydrate current head SHA check runs, legacy status contexts, closing issue references, and readiness. Expose an explicit state for missing, pending, partial, and unknown results.
- [ ] Wire repo, authored-by-me, strict all-CI, linked-issue, and ready-to-merge filters. Preserve skipped PRs across filter changes until Reset skipped or a new session.
- [ ] Wire left/right arrows and visible Skip/Merge buttons. Ignore shortcuts in form/editable focus, with modifiers, on key repeat, and while an operation is locked.
- [ ] On merge action, lock the PR, fetch fresh state, reject changed head/base, drafts, unknown/ineligible filters, unsupported merge methods, stacks, and merge queue requirements, then submit a SHA-bound asynchronous direct merge with rule bypass disabled.
- [ ] Persist operation metadata before submit, reconcile pending/duplicate/lost responses after reopening, and advance only after a confirmed merged result. Add source repository links and readable failure reasons.
- [ ] In Demo mode, Skip only advances the fixture queue and Merge displays a notice that live GitHub is not connected; never call the merge endpoint.

### Task 5: Document Chrome testing and verify the package

**Files:** `docs/chrome-extension-testing.md` and any fixes required by Tasks 1–4.

- [ ] Explain prerequisites, `npm install`, `npm run build`, loading `dist/` from `chrome://extensions`, and pinning the toolbar icon.
- [ ] Explain the Demo walkthrough, then live setup with fine-grained token permissions, connections for personal/organization owners, pins, dashboard metrics, filters, arrow controls, and a safe merge dry walkthrough.
- [ ] Explain how to reload after changes and inspect extension/service-worker errors. State that Demo mode performs no remote actions and a live merge affects GitHub immediately.
- [ ] Run `npm run typecheck`, `npm test`, and `npm run build`; confirm package files referenced by the manifest exist and the working tree contains no generated secrets.
- [ ] Perform the final self-review against the Review focus list and record the result in the progress ledger.
