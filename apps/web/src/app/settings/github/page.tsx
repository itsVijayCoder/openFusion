import type {
  GitHubInstallationRef,
  GitHubRepositoryRef,
  GitHubUserLinkRef,
  WorkspaceRef,
} from "@fusion-harness/shared";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { DataNotice, EmptyState, PageHeader, Section, StatusPill } from "@/components/product-ui";
import { apiGet } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { GitHubActions, UserLinkForm } from "@/features/pr-reviews/github-actions";

export const dynamic = "force-dynamic";

type GitHubStatusResponse = {
  configured: boolean;
  appId: string;
  appSlug: string;
  appName: string;
  htmlUrl: string;
  error?: string;
};

type InstallationsResponse = { data: GitHubInstallationRef[] };
type RepositoriesResponse = { data: GitHubRepositoryRef[] };
type UserLinksResponse = { data: GitHubUserLinkRef[] };
type WorkspacesResponse = { data: WorkspaceRef[] };

export default async function GitHubSettingsPage() {
  const [status, installations, repositories, userLinks, workspaces] = await Promise.all([
    apiGet<GitHubStatusResponse>("/api/github/status", {
      configured: false,
      appId: "",
      appSlug: "",
      appName: "",
      htmlUrl: "",
    }),
    apiGet<InstallationsResponse>("/api/github/installations", { data: [] }),
    apiGet<RepositoriesResponse>("/api/github/repositories", { data: [] }),
    apiGet<UserLinksResponse>("/api/github/user-links", { data: [] }),
    apiGet<WorkspacesResponse>("/api/workspaces", { data: [] }),
  ]);

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title="GitHub Settings"
        description="Connect the Fusion GitHub App, manage repository links, reviewer mappings, and auto-review policies."
        actions={
          <div className="flex gap-2">
            <GitHubActions />
            <Button asChild variant="secondary" size="sm">
              <Link href="/pr-reviews">Open PR Reviews</Link>
            </Button>
          </div>
        }
      />
      <DataNotice source={status.source} error={status.error} />

      <Section title="GitHub App Connection">
        <div className="rounded-lg border border-border bg-card p-4">
          {status.data.configured ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <StatusPill value="connected" />
                <span className="text-sm font-medium text-foreground">
                  {status.data.appName || status.data.appSlug || "Fusion GitHub App"}
                </span>
              </div>
              <dl className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
                <div>
                  <dt className="text-xs font-medium uppercase">App ID</dt>
                  <dd className="font-mono">{status.data.appId}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase">App Slug</dt>
                  <dd className="font-mono">{status.data.appSlug || "Not loaded"}</dd>
                </div>
              </dl>
              {status.data.htmlUrl ? (
                <Link
                  href={status.data.htmlUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm text-primary hover:underline"
                >
                  View on GitHub
                </Link>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <StatusPill value="not_connected" />
              <p className="text-sm text-muted-foreground">
                Set <code className="font-mono">GITHUB_APP_ID</code>,{" "}
                <code className="font-mono">GITHUB_APP_PRIVATE_KEY</code>, and{" "}
                <code className="font-mono">GITHUB_WEBHOOK_SECRET</code> as Worker secrets, then sync.
              </p>
              <p className="text-sm text-muted-foreground">
                See <Link href="/Docs/GITHUB_APP_SETUP.md" className="text-primary hover:underline">setup guide</Link> for instructions.
              </p>
            </div>
          )}
        </div>
      </Section>

      <Section title="Installed Accounts">
        {installations.data.data.length ? (
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Account</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Selection</th>
                  <th className="px-4 py-3 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {installations.data.data.map((installation) => (
                  <tr key={installation.id}>
                    <td className="px-4 py-3 font-medium">{installation.accountLogin}</td>
                    <td className="px-4 py-3 text-muted-foreground">{installation.accountType}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {installation.repositorySelection ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatDateTime(installation.updatedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="No installations found"
            description="Install the Fusion GitHub App on a repository or organization, then click Sync."
          />
        )}
      </Section>

      <Section title="Repositories">
        {repositories.data.data.length ? (
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Repository</th>
                  <th className="px-4 py-3 font-medium">Workspace</th>
                  <th className="px-4 py-3 font-medium">Auto-Review</th>
                  <th className="px-4 py-3 font-medium">Trigger</th>
                  <th className="px-4 py-3 font-medium">Visibility</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {repositories.data.data.map((repo) => {
                  const workspace = workspaces.data.data.find((ws) => ws.id === repo.workspaceId);
                  return (
                    <tr key={repo.id}>
                      <td className="px-4 py-3 font-medium">{repo.fullName}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {workspace?.name ?? "Not linked"}
                      </td>
                      <td className="px-4 py-3">
                        <StatusPill value={repo.autoReviewEnabled ? "enabled" : "disabled"} />
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{repo.autoReviewTrigger}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {repo.private ? "Private" : "Public"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="No repositories synced"
            description="Install the GitHub App on repositories and run a sync to populate this list."
          />
        )}
      </Section>

      <Section title="Reviewer Mappings">
        {userLinks.data.data.length ? (
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Fusion User</th>
                  <th className="px-4 py-3 font-medium">GitHub Login</th>
                  <th className="px-4 py-3 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {userLinks.data.data.map((link) => (
                  <tr key={link.id}>
                    <td className="px-4 py-3 font-mono text-xs">{link.userId}</td>
                    <td className="px-4 py-3 font-medium">{link.githubLogin}</td>
                    <td className="px-4 py-3 text-muted-foreground">{formatDateTime(link.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="No reviewer mappings"
            description="Map Fusion users to GitHub logins so review requests trigger the correct reviewer."
          />
        )}
        <div className="mt-3">
          <UserLinkForm userId="usr_developer_fusion_local" />
        </div>
      </Section>
    </div>
  );
}