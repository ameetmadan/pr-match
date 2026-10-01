# Test PR Match in Chrome

PR Match is an unpacked Chrome extension. You can explore the sample workspace without a GitHub token. Connecting GitHub enables live repository data and real merge actions.

## Requirements

- Google Chrome 120 or newer
- Node.js 22.12 or newer and npm
- This repository checked out locally

## Build and load the extension

From the project directory, run:

```sh
npm install
npm run build
```

Then in Chrome:

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Choose **Load unpacked**.
4. Select the `dist` folder inside this repository.
5. Optionally pin **PR Match** from Chrome’s Extensions menu.
6. Click the PR Match toolbar icon to open the dashboard. The app opens in a tab.

After changing code, run `npm run build`, return to `chrome://extensions`, click the extension’s reload icon, then reload the PR Match tab.

## Explore the sample workspace

The first launch opens in **Demo mode** with sample repositories, dashboard metrics, and pull requests. The page labels the sample data. You can pin or unpin example projects, change filters, and use the keyboard actions. Demo mode does not call GitHub and merge is disabled.

In the Pull requests page:

- **Left arrow** skips the current card.
- **Right arrow** submits a merge only when the displayed checks say it is ready. In Demo mode this action is disabled.
- Use the repository selector and filter chips to narrow the queue.
- Select **Settings → Switch to demo mode** to return to the sample workspace.

## Connect a GitHub account

Create a [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new) and grant access to the repositories you want PR Match to read. The token owner should be your GitHub account; enter the account or organization whose repositories you want included in the **Account or organization** field.

For read-only use, grant repository **Metadata**, **Pull requests**, **Issues**, **Checks**, **Commit statuses**, and **Deployments** read permissions. Grant **Contents: read and write** only if you want the merge action enabled; GitHub’s asynchronous merge endpoint requires Contents write. Organization tokens may need organization approval. GitHub returns only repositories the token can access.

In PR Match, open **Settings**, enter the owner and token, then choose **Connect GitHub**. The token is stored in Chrome’s local extension storage and is sent only by the extension service worker to `api.github.com`. You can remove a connection in Settings. Turning Demo mode off shows the connected GitHub workspace.

Pin a repository on the Projects page to see open issues, open pull requests, and pull requests merged today. PR Match looks for a successful production deployment URL in GitHub’s deployment records. Use the environment selector or **Deployment link settings** if your project uses a different environment or needs a manual HTTPS link.

## Try a real merge carefully

Merging is a real GitHub action with no confirmation step. Use a disposable test repository and a pull request you intend to merge. Confirm its branch protection and required reviews are configured as you expect. The right arrow and **Merge pull request** button submit immediately; PR Match asks GitHub to apply the selected merge method without bypassing repository rules.

If GitHub queues a merge or the status cannot be confirmed, PR Match displays that state instead of treating it as merged. Refresh the dashboard before attempting another action.

## Troubleshooting

- If the extension does not appear, make sure you selected `dist`, not the repository root, and that `npm run build` completed successfully.
- If the app shows old data, use the refresh button or reload the extension and app tab. Repository responses are cached in the current Chrome session for up to five minutes.
- If GitHub reports missing access, check the token’s selected repositories, permissions, and any organization approval requirement.
- For service worker errors, open `chrome://extensions`, find PR Match, and click its **Service worker** link. Do not share screenshots or logs containing your token.

## Developer checks

```sh
npm run typecheck
npm test
npm run build
```
