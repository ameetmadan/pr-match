# PR Match

PR Match is a local Chrome extension for a quieter view of your GitHub projects and open pull requests. Pin repositories to a compact progress dashboard, or review the cross-repository queue one pull request at a time.

## Features

- Project cards with open issue and PR counts, PRs merged today, and deployment links from GitHub deployment records.
- A cross-repository pull request queue with CI, linked issue, readiness, author, and repository filters.
- Left arrow to skip and right arrow to merge. The merge uses the displayed commit SHA and does not bypass repository rules.
- Offline demo workspace with sample projects and read-only merge actions.
- GitHub tokens and settings stay in Chrome extension storage; there is no PR Match backend.

## Try it in Chrome

See [the Chrome extension testing guide](docs/chrome-extension-testing.md) for install steps, demo walkthrough, GitHub token permissions, and live merge testing.

## Developer commands

```sh
npm install
npm run typecheck
npm test
npm run build
```

The unpacked extension is emitted into `dist/`. Load that directory from `chrome://extensions` with Developer mode enabled.

## Current scope

This is an early local extension build. GitHub data coverage depends on the fine-grained token's repository selection and organization approval. GitHub remains the authority for repository merge rules and merge outcomes.
