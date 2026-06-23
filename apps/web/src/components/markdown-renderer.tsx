"use client";

import { memo, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
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
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={components(size)}>
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
    h1: ({ children }: { children?: ReactNode }) => (
      <h1 className={cn("mt-5 mb-3 font-semibold text-foreground first:mt-0", heading1)}>{children}</h1>
    ),
    h2: ({ children }: { children?: ReactNode }) => (
      <h2 className={cn("mt-4 mb-2.5 font-semibold text-foreground first:mt-0", heading2)}>{children}</h2>
    ),
    h3: ({ children }: { children?: ReactNode }) => (
      <h3 className={cn("mt-3.5 mb-2 font-semibold text-foreground first:mt-0", heading3)}>{children}</h3>
    ),
    h4: ({ children }: { children?: ReactNode }) => (
      <h4 className={cn("mt-3 mb-1.5 font-medium text-foreground first:mt-0", heading3)}>{children}</h4>
    ),
    h5: ({ children }: { children?: ReactNode }) => (
      <h5 className={cn("mt-3 mb-1.5 font-medium text-foreground first:mt-0", heading3)}>{children}</h5>
    ),
    h6: ({ children }: { children?: ReactNode }) => (
      <h6 className={cn("mt-3 mb-1.5 font-medium text-muted-foreground first:mt-0", heading3)}>{children}</h6>
    ),
    p: ({ children }: { children?: ReactNode }) => (
      <p className={cn("my-2.5 text-foreground first:mt-0 last:mb-0", baseText, leading)}>{children}</p>
    ),
    ul: ({ children }: { children?: ReactNode }) => (
      <ul className={cn("my-2.5 ml-5 list-disc space-y-1.5 text-foreground", baseText, leading)}>{children}</ul>
    ),
    ol: ({ children }: { children?: ReactNode }) => (
      <ol className={cn("my-2.5 ml-5 list-decimal space-y-1.5 text-foreground", baseText, leading)}>{children}</ol>
    ),
    li: ({ children, checked }: { children?: ReactNode; checked?: boolean | null }) => {
      if (checked !== null && checked !== undefined) {
        return (
          <li className="flex items-start gap-2 pl-1">
            <span
              className={cn(
                "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border",
                checked ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background",
              )}
            >
              {checked ? "✓" : ""}
            </span>
            <span className="flex-1">{children}</span>
          </li>
        );
      }
      return <li className="pl-1">{children}</li>;
    },
    strong: ({ children }: { children?: ReactNode }) => (
      <strong className="font-semibold text-foreground">{children}</strong>
    ),
    em: ({ children }: { children?: ReactNode }) => <em className="italic text-foreground">{children}</em>,
    del: ({ children }: { children?: ReactNode }) => (
      <del className="text-muted-foreground line-through">{children}</del>
    ),
    code: ({ className: codeClass, children }: { className?: string; children?: ReactNode }) => {
      const isInline = !codeClass;
      if (isInline) {
        return (
          <code className={cn("rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-foreground", codeSize)}>
            {children}
          </code>
        );
      }
      return <code className={cn("block font-mono", codeSize)}>{children}</code>;
    },
    pre: ({ children }: { children?: ReactNode }) => <CodeBlock>{children}</CodeBlock>,
    blockquote: ({ children }: { children?: ReactNode }) => (
      <blockquote className="my-3 border-l-2 border-primary/50 pl-4 text-foreground italic opacity-80">
        {children}
      </blockquote>
    ),
    a: ({ href, children }: { href?: string; children?: ReactNode }) => (
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
    table: ({ children }: { children?: ReactNode }) => (
      <div className="my-3 overflow-x-auto rounded-lg border border-border">
        <table className="w-full border-collapse text-sm">{children}</table>
      </div>
    ),
    thead: ({ children }: { children?: ReactNode }) => (
      <thead className="border-b border-border bg-muted/50">{children}</thead>
    ),
    tbody: ({ children }: { children?: ReactNode }) => <tbody className="divide-y divide-border">{children}</tbody>,
    th: ({ children }: { children?: ReactNode }) => (
      <th className="px-3 py-2 text-left font-semibold text-foreground">{children}</th>
    ),
    td: ({ children }: { children?: ReactNode }) => (
      <td className="border-t border-border px-3 py-2 text-foreground">{children}</td>
    ),
    img: ({ src, alt }: { src?: string | Blob; alt?: string }) => (
      <img
        src={typeof src === "string" ? src : undefined}
        alt={alt ?? ""}
        className="my-3 max-w-full rounded-lg border border-border"
        loading="lazy"
      />
    ),
  } as const;
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    const text = extractText(children);
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    });
  }

  const language = extractLanguage(children);

  return (
    <div className="group/code my-3 overflow-hidden rounded-lg border border-border bg-muted/60">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <span className="text-[11px] font-medium uppercase text-muted-foreground">
          {language ?? "code"}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 text-foreground">{children}</pre>
    </div>
  );
}

function extractText(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (node && typeof node === "object" && "props" in node) {
    const props = (node as { props: { children?: ReactNode } }).props;
    return extractText(props.children);
  }
  return "";
}

function extractLanguage(node: ReactNode): string | undefined {
  if (node && typeof node === "object" && "props" in node) {
    const props = (node as { props: { className?: string } }).props;
    const className = props.className ?? "";
    const match = className.match(/language-(\w+)/);
    if (match) return match[1];
  }
  return undefined;
}