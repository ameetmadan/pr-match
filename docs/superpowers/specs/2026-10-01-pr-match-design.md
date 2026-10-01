# PR Match: GitHub dashboard and review queue

## Goal

Build a local-first Chrome extension that gives a developer a simpler view of their GitHub work. The extension opens to a dashboard of pinned repositories and provides a focused queue for reviewing and merging open pull requests.

## Decisions

- The dashboard is the first screen; the review queue is a separate screen in the same extension.
- The extension calls GitHub directly and has no hosted backend.
- The user supplies a fine-grained GitHub personal access token. Settings and pinned repositories are stored in `chrome.storage.local`.
- Project deployment links come from GitHub deployment records where available. A per-repository manual URL can override or fill a missing deployment URL.
- In the review queue, left arrow skips the current PR and right arrow requests a merge. Merge is allowed only when the user's active filters pass and GitHub reports the PR as mergeable. The user can choose the merge method in settings.

## Main screens

### Dashboard

The dashboard lists repositories the user has pinned. Each repository card shows:

- Repository name and owner.
- Link to the latest successful production deployment, based on GitHub deployment records. Show a clear unavailable state when no production deployment URL is reported. Allow a manual URL override.
- Count of PRs merged during the current local calendar day.
- Count of open issues, excluding pull requests.
- A link into that repository's open PRs in the review queue.

The dashboard includes a way to pin and unpin repositories, refresh data, and navigate to the review queue and settings. Empty, loading, stale, and API-error states are visible and recoverable.

### Review queue

The queue shows one open pull request at a time, with repository, title, number, author, age, draft state, CI/check summary, linked-issue state, mergeability, and a link to the PR on GitHub. Repository and eligibility filters let the user narrow the queue. The initial eligibility filters are:

- All required CI/checks passing.
- At least one GitHub-linked issue.
- GitHub reports the PR as mergeable.

Left arrow skips without changing the PR. Right arrow submits a merge using the configured merge method. A visible button provides the same action for users who do not use a keyboard. A skipped PR is deferred for the current queue session so it is not immediately shown again.

Before submitting a merge, the extension refreshes the PR's checks and mergeability. The GitHub merge response is authoritative; conflicts, changed checks, permission errors, and other failures leave the PR in the queue with an explanation and a way to retry or open it on GitHub. Successful merges advance to the next eligible PR.

For the first version, “linked issue” means an issue GitHub associates with the pull request as a closing issue. A plain issue number mention is not sufficient.

## Data and integration

- Use GitHub's authenticated API to list repositories visible to the token, load open PRs, check rollups, linked closing issues, merge status, issue counts, merge history, and deployments.
- Use the GitHub Deployments API to find the most recent successful deployment marked as production and use its environment URL when present.
- Treat GitHub as the source of truth. Cache read responses briefly to keep navigation responsive, show when displayed data is stale, and allow explicit refresh.
- “Merged today” uses the browser's local calendar day and `merged_at`; open issue counts exclude items with a `pull_request` field.
- Vercel-specific API access is not required. Repositories without a usable GitHub production deployment URL can use the manual URL field.
- The initial review queue includes open PRs authored by the connected GitHub user across repositories accessible to the token. The repository filter can narrow this set. (This is an explicit assumption from “open PRs over your whole profile.”)

## Permissions and privacy

The extension requests only the Chrome permissions needed for an extension page, local settings storage, and requests to `api.github.com`. It does not inject scripts into GitHub pages, read browsing history, or send data to a project server.

The fine-grained token needs repository metadata read access; issues read access; pull requests read and write access for merge actions; checks read access; and deployments read access. The user chooses which repositories the token can access. The UI explains that limited token access also limits repositories and data visible to the extension. The token is held in Chrome local extension storage and never logged or included in error messages.

## Implementation shape

- Manifest V3 extension with a toolbar action that opens the dashboard in a full tab.
- TypeScript UI with separate dashboard, review queue, and settings views.
- A small GitHub API client boundary handles authentication, pagination, rate limits, and typed errors.
- Domain functions derive dashboard metrics and queue eligibility from API data.
- A background service worker is used only where needed for extension lifecycle behavior; API and view logic stay in modules that can be exercised without browser infrastructure.

## Failure and edge cases

- Invalid, expired, or under-permissioned token: explain the problem and provide a settings path.
- GitHub rate limiting or transient errors: preserve the last cached dashboard data, mark it stale, and offer retry.
- Pagination: fetch all results needed for the current view while respecting GitHub API limits.
- PR changes after display: refresh before merge and display GitHub's rejection if the PR is no longer mergeable or eligible.
- No linked issue, no checks configured, queued/pending checks, and unknown mergeability are distinct states. Unknown or pending state never satisfies a passing-check filter.
- Manual deployment URL: validate as an HTTPS URL before saving.

## Out of scope for the first version

- Hosted service, OAuth broker, or Vercel API integration.
- Changing GitHub repository settings, CI workflows, issues, or PR descriptions.
- Automatic background merges or bypassing branch protections.
- Analytics or telemetry sent outside the browser.

## Acceptance criteria

1. A user can save a GitHub token, see accessible repositories, pin repositories, and reopen the extension with pins preserved.
2. Each pinned repo card reports merged-today and open-issue counts, and links to the most recent successful production deployment when GitHub supplies a URL; a manual URL can fill gaps.
3. The user can browse their open authored PRs across accessible repositories and filter by repository, passing checks, linked issue, and mergeability.
4. Keyboard and visible controls can skip or request a merge. A merge is never submitted while an active eligibility filter fails, and each attempted merge is checked against current GitHub state.
5. API errors, missing permissions, unavailable deployment links, loading, empty, and stale data states are understandable and do not silently present stale data as current.
6. The extension makes no network requests to a project backend and does not log the token.

## Design notes and source references

- GitHub REST Deployments API documents deployment environments and deployment status URLs: https://docs.github.com/en/rest/deployments/deployments
- Vercel's GitHub integration reports deployments and preview URLs through GitHub: https://vercel.com/docs/git/vercel-for-github

