"use client";

import { Check, Copy, Download, X } from "lucide-react";
import { useState } from "react";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { StatusPill } from "@/components/product-ui";

type OutputDrawerProps = {
  title: string;
  subtitle?: string;
  status?: string;
  content: string;
  error?: string;
  onClose: () => void;
};

export function OutputDrawer({ title, subtitle, status, content, error, onClose }: OutputDrawerProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore
    }
  }

  function handleDownload() {
    const blob = new Blob([content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed right-0 top-0 z-50 flex h-full w-full max-w-lg flex-col border-l border-border bg-secondary">
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-semibold text-foreground">{title}</span>
              {status ? <StatusPill value={status} /> : null}
            </div>
            {subtitle ? (
              <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
            ) : null}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={handleCopy}
              disabled={!content}
              className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
              title="Copy"
            >
              {copied ? <Check aria-hidden className="size-4 text-primary" /> : <Copy aria-hidden className="size-4" />}
            </button>
            <button
              onClick={handleDownload}
              disabled={!content}
              className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
              title="Download as .md"
            >
              <Download aria-hidden className="size-4" />
            </button>
            <div className="mx-1 h-5 w-px bg-border" />
            <button
              onClick={onClose}
              className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X aria-hidden className="size-4" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {error ? (
            <p className="break-words text-sm text-destructive">{error}</p>
          ) : content ? (
            <MarkdownRenderer content={content} />
          ) : (
            <p className="text-sm text-muted-foreground">No output yet.</p>
          )}
        </div>
      </div>
    </>
  );
}