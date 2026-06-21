# GitHub App Setup Guide

This guide walks through creating and configuring the Fusion GitHub App for PR reviews.

## 1. Create the GitHub App

1. Go to **GitHub Settings > Developer settings > GitHub Apps > New GitHub App**
2. Fill in the following:

| Field | Value |
| --- | --- |
| GitHub App name | `Fusion PR Review` |
| Homepage URL | `https://your-fusion-deployment.example.com` |
| Webhook URL | `https://your-fusion-api.example.com/api/github/webhook` |
| Webhook secret (active) | Generate a strong random secret |

3. Set **Repository permissions**:

| Permission | Access | Purpose |
| --- | --- | --- |
| Metadata | Read-only | Required baseline |
| Contents | Read-only | Fetch repository content and PR refs |
| Pull requests | Read and write | Read PRs, review requests, publish reviews |
| Checks | Read and write | Create/update Fusion PR Review check run |
| Issues | Read and write | Optional PR timeline comments |
| Members | Read-only | Optional org/team reviewer mapping |

4. Set **Subscribe to events**:

```
Installation
Installation repositories
Pull request
Pull request review
Pull request review comment
Check suite
Check run
```

5. Click **Create GitHub App**

## 2. Generate a Private Key

After creating the app:
1. Scroll down to **Private keys**
2. Click **Generate a private key**
3. A `.pem` file will download — keep this secure

## 3. Note the App ID

Find the **App ID** on the app's general settings page (it's a numeric ID like `123456`).

## 4. Configure Worker Secrets

Set the following secrets on your Cloudflare Worker:

```bash
# Using wrangler CLI
wrangler secret put GITHUB_APP_ID --env production
# Enter the numeric App ID

wrangler secret put GITHUB_APP_PRIVATE_KEY --env production
# Paste the full contents of the .pem file

wrangler secret put GITHUB_WEBHOOK_SECRET --env production
# Enter the webhook secret you generated in step 1
```

For local development, add these to `.dev.vars`:

```
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----\n"
GITHUB_WEBHOOK_SECRET=your_webhook_secret
```

## 5. Install the App

1. On the app's settings page, click **Install App**
2. Choose to install on your user account or an organization
3. Select the repositories you want Fusion to review
4. Complete the installation

## 6. Verify the Connection

1. Navigate to `/settings/github` in your Fusion deployment
2. The page should show the app as connected with the correct App ID and slug
3. Click **Sync** to pull in installations and repositories

## 7. Configure Repository Settings

For each repository you want to enable PR reviews on:

1. Go to `/settings/github` in Fusion
2. Find the repository in the list
3. Link it to a Fusion workspace
4. Set a default runner
5. Enable auto-review (optional) with the trigger set to `review_requested`
6. Keep auto-publish disabled (MVP requires human approval)

## 8. Map Reviewers

Map Fusion users to GitHub logins so review requests trigger correctly:

1. Go to `/settings/github`
2. In the **Reviewer Mappings** section, create a link between a Fusion user and their GitHub login

## 9. Test the Flow

1. Open a PR on a connected repository
2. Request a review from the mapped GitHub user
3. Verify the PR appears in `/pr-reviews` with status `assigned`
4. Click the PR to view the diff
5. Click **Start Review** to trigger the local agent
6. Wait for draft comments to appear
7. Edit or reject comments as needed
8. Click **Publish** to post the review to GitHub

## Security Notes

- The GitHub App private key and webhook secret are stored as Cloudflare Worker secrets and never sent to the browser
- Installation tokens are short-lived (1 hour) and cached in-memory only
- Webhook payloads are stored in R2 for debugging but should be redacted if they contain sensitive information
- Fork PRs are marked as `ignored` by default and cannot trigger full reviews
- The runner does not execute test or build commands during review (MVP)
- All publish operations require human approval and are audited