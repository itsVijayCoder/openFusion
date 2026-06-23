"use client";

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

type MarkdownRendererProps = {
  content: string;
  className?: string;
  size?: "sm" | "md" | "lg";
};

export const MarkdownRenderer = memo(function MarkdownRenderer({ content, className, size = "md" }: MarkdownRendererProps) {
  return (
    <div className={cn("prose-fusion", size === "lg" && "prose-fusion-lg", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components(size)}>
        {content}
      </ReactMarkdown>
    </div>
  );
});

function components(size: "sm" | "md" | "lg") {
  const baseText = size === "lg" ? "text-[15px]" : size === "sm" ? "text-[13px]" : "text-sm";
  const leading = size === "lg" ? "leading-7" : "leading-6";
  const heading1 = size === "lg" ? "text-xl" : "text-lg";
  const heading2 = size === "lg" ? "text-lg" : "text-base";
  const heading3 = size === "lg" ? "text-base" : "text-sm";
  const codeSize = size === "lg" ? "text-[14px]" : "text-[13px]";

  return {
    h1: ({ children }: { children?: React.ReactNode }) => (
      <h1 className={cn("mt-5 mb-3 font-semibold text-foreground first:mt-0", heading1)}>{children}</h1>
    ),
    h2: ({ children }: { children?: React.ReactNode }) => (
      <h2 className={cn("mt-4 mb-2.5 font-semibold text-foreground first:mt-0", heading2)}>{children}</h2>
    ),
    h3: ({ children }: { children?: React.ReactNode }) => (
      <h3 className={cn("mt-3.5 mb-2 font-semibold text-foreground first:mt-0", heading3)}>{children}</h3>
    ),
    h4: ({ children }: { children?: React.ReactNode }) => (
      <h4 className={cn("mt-3 mb-1.5 font-medium text-foreground first:mt-0", heading3)}>{children}</h4>
    ),
    p: ({ children }: { children?: React.ReactNode }) => (
      <p className={cn("my-2.5 text-foreground first:mt-0 last:mb-0", baseText, leading)}>{children}</p>
    ),
    ul: ({ children }: { children?: React.ReactNode }) => (
      <ul className={cn("my-2.5 ml-5 list-disc space-y-1.5 text-foreground", baseText, leading)}>{children}</ul>
    ),
    ol: ({ children }: { children?: React.ReactNode }) => (
      <ol className={cn("my-2.5 ml-5 list-decimal space-y-1.5 text-foreground", baseText, leading)}>{children}</ol>
    ),
    li: ({ children }: { children?: React.ReactNode }) => <li className="pl-1">{children}</li>,
    strong: ({ children }: { children?: React.ReactNode }) => (
      <strong className="font-semibold text-foreground">{children}</strong>
    ),
    em: ({ children }: { children?: React.ReactNode }) => <em className="italic text-foreground">{children}</em>,
    code: ({ className: codeClass, children }: { className?: string; children?: React.ReactNode }) => {
      const isInline = !codeClass;
      if (isInline) {
        return (
          <code className={cn("rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-foreground", codeSize)}>
            {children}
          </code>
        );
      }
      return (
        <code className={cn("block font-mono", codeSize)}>{children}</code>
      );
    },
    pre: ({ children }: { children?: React.ReactNode }) => (
      <pre className="my-3 overflow-x-auto rounded-lg border border-border bg-muted/60 p-4 text-foreground">
        {children}
      </pre>
    ),
    blockquote: ({ children }: { children?: React.ReactNode }) => (
      <blockquote className="my-3 border-l-2 border-primary/50 pl-4 text-foreground italic opacity-80">
        {children}
      </blockquote>
    ),
    a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary underline underline-offset-2 hover:text-primary/80"
      >
        {children}
      </a>
    ),
    hr: () => <hr className="my-4 border-border" />,
    table: ({ children }: { children?: React.ReactNode }) => (
      <div className="my-3 overflow-x-auto rounded-lg border border-border">
        <table className="w-full border-collapse text-sm">{children}</table>
      </div>
    ),
    thead: ({ children }: { children?: React.ReactNode }) => (
      <thead className="border-b border-border bg-muted/50">{children}</thead>
    ),
    th: ({ children }: { children?: React.ReactNode }) => (
      <th className="px-3 py-2 text-left font-semibold text-foreground">{children}</th>
    ),
    td: ({ children }: { children?: React.ReactNode }) => (
      <td className="border-t border-border px-3 py-2 text-foreground">{children}</td>
    ),
  } as const;
}