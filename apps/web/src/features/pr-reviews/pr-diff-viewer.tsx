"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import type { PrDiffFile, PrDiffSnapshot, PrReviewCommentRef } from "@fusion-harness/shared";
import { cn } from "@/lib/utils";
import { apiUrl } from "@/lib/api";

const DiffEditor = dynamic(() => import("@monaco-editor/react").then((mod) => mod.DiffEditor), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      Loading diff editor...
    </div>
  ),
});

type PrDiffViewerProps = {
  prId: string;
  diff: PrDiffSnapshot | null;
  comments: PrReviewCommentRef[];
};

type FileContent = {
  before: string;
  after: string;
};

export function PrDiffViewer({ prId, diff, comments }: PrDiffViewerProps) {
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [loadedFileName, setLoadedFileName] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<FileContent>({ before: "", after: "" });

  const commentsByFile = useMemo(() => {
    const map = new Map<string, PrReviewCommentRef[]>();
    for (const comment of comments) {
      const existing = map.get(comment.filePath) ?? [];
      existing.push(comment);
      map.set(comment.filePath, existing);
    }
    return map;
  }, [comments]);

  const selectedFile = useMemo(() => {
    if (!diff || diff.files.length === 0) return null;
    if (selectedFileName) {
      return diff.files.find((f) => f.filename === selectedFileName) ?? null;
    }
    return diff.files[0] ?? null;
  }, [diff, selectedFileName]);

  const isLoading = selectedFile?.filename !== loadedFileName;

  useEffect(() => {
    if (!selectedFile) return;
    const file = selectedFile;
    let cancelled = false;

    (async () => {
      const [beforeRes, afterRes] = await Promise.all([
        file.status === "added"
          ? Promise.resolve({ content: "" })
          : fetch(
              apiUrl(`/api/pr-reviews/${prId}/diff/files/content?filename=${encodeURIComponent(file.filename)}&side=LEFT`),
            ).then((r) => r.json()),
        file.status === "removed"
          ? Promise.resolve({ content: "" })
          : fetch(
              apiUrl(`/api/pr-reviews/${prId}/diff/files/content?filename=${encodeURIComponent(file.filename)}&side=RIGHT`),
            ).then((r) => r.json()),
      ]);

      if (cancelled) return;
      setFileContent({
        before: (beforeRes as { content: string }).content ?? "",
        after: (afterRes as { content: string }).content ?? "",
      });
      setLoadedFileName(file.filename);
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedFile, prId]);

  if (!diff || diff.files.length === 0) {
    return (
      <div className="flex h-96 items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
        No changed files in this pull request.
      </div>
    );
  }

  const language = selectedFile ? detectLanguage(selectedFile.filename) : "plaintext";

  return (
    <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
      <div className="rounded-lg border border-border bg-card">
        <div className="border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground">
          Changed Files ({diff.files.length})
        </div>
        <div className="max-h-[600px] overflow-y-auto">
          {diff.files.map((file) => {
            const fileComments = commentsByFile.get(file.filename) ?? [];
            const active = selectedFile?.filename === file.filename;
            return (
              <button
                key={file.filename}
                type="button"
                onClick={() => setSelectedFileName(file.filename)}
                className={cn(
                  "flex w-full items-center gap-2 border-b border-border px-3 py-2 text-left text-xs transition-colors",
                  active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted",
                )}
              >
                <span className={cn("size-1.5 shrink-0 rounded-full", statusColor(file.status))} />
                <span className="truncate font-mono">{file.filename}</span>
                {fileComments.length > 0 ? (
                  <span className="ml-auto shrink-0 rounded bg-primary px-1.5 text-xs text-primary-foreground">
                    {fileComments.length}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {selectedFile ? (
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="font-mono">{selectedFile.filename}</span>
            <span className="rounded border border-border px-1.5 py-0.5">{selectedFile.status}</span>
            <span className="text-green-600 dark:text-green-400">+{selectedFile.additions}</span>
            <span className="text-red-600 dark:text-red-400">-{selectedFile.deletions}</span>
          </div>
        ) : null}

        <div className="h-[600px] overflow-hidden rounded-lg border border-border">
          {isLoading ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Loading file content...
            </div>
          ) : (
            <DiffEditor
              original={fileContent.before}
              modified={fileContent.after}
              language={language}
              theme="vs-dark"
              options={{
                readOnly: true,
                renderSideBySide: true,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                fontSize: 13,
                lineNumbers: "on",
                automaticLayout: true,
              }}
            />
          )}
        </div>

        {selectedFile ? (
          <FileComments comments={commentsByFile.get(selectedFile.filename) ?? []} />
        ) : null}
      </div>
    </div>
  );
}

function FileComments({ comments }: { comments: PrReviewCommentRef[] }) {
  if (comments.length === 0) return null;

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground">
        Draft Comments ({comments.length})
      </div>
      <div className="divide-y divide-border">
        {comments.map((comment) => (
          <div key={comment.id} className="p-3 text-sm">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "rounded border px-1.5 py-0.5 text-xs font-medium",
                  comment.severity === "blocker"
                    ? "border-destructive/30 bg-destructive/10 text-destructive"
                    : comment.severity === "major"
                      ? "border-orange-500/30 bg-orange-500/10 text-orange-600 dark:text-orange-400"
                      : comment.severity === "minor"
                        ? "border-yellow-500/30 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400"
                        : "border-border bg-muted text-muted-foreground",
                )}
              >
                {comment.severity}
              </span>
              <span className="text-xs text-muted-foreground">{comment.category}</span>
              {comment.line ? (
                <span className="text-xs text-muted-foreground">Line {comment.line}</span>
              ) : null}
            </div>
            <p className="mt-2 text-muted-foreground">{comment.body}</p>
            {comment.suggestedChange ? (
              <pre className="mt-2 overflow-x-auto rounded border border-border bg-muted p-2 text-xs">
                <code>{comment.suggestedChange}</code>
              </pre>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function statusColor(status: PrDiffFile["status"]): string {
  switch (status) {
    case "added":
      return "bg-green-500";
    case "removed":
      return "bg-red-500";
    case "modified":
      return "bg-yellow-500";
    case "renamed":
      return "bg-blue-500";
    default:
      return "bg-muted-foreground";
  }
}

function detectLanguage(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    mjs: "javascript",
    go: "go",
    py: "python",
    rb: "ruby",
    rs: "rust",
    java: "java",
    kt: "kotlin",
    swift: "swift",
    c: "c",
    h: "c",
    cpp: "cpp",
    hpp: "cpp",
    cs: "csharp",
    php: "php",
    sql: "sql",
    sh: "shell",
    bash: "shell",
    yml: "yaml",
    yaml: "yaml",
    json: "json",
    xml: "xml",
    html: "html",
    css: "css",
    scss: "scss",
    md: "markdown",
    toml: "ini",
    ini: "ini",
  };
  return map[ext] ?? "plaintext";
}