'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Renders an AI assistant message as Markdown (GitHub-flavoured, so tables
 * and task lists work), with Tailwind-styled elements so tables, lists and
 * code blocks read cleanly inside a chat bubble instead of showing raw
 * pipes and dashes.
 */
export function MarkdownMessage({ content }: { content: string }) {
  return (
    <div className="text-sm leading-relaxed break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="my-1.5 first:mt-0 last:mb-0">{children}</p>,
          ul: ({ children }) => (
            <ul className="my-1.5 list-disc space-y-1 pl-5">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="my-1.5 list-decimal space-y-1 pl-5">{children}</ol>
          ),
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium underline underline-offset-2"
            >
              {children}
            </a>
          ),
          h1: ({ children }) => <h1 className="mb-1 mt-2 text-base font-semibold">{children}</h1>,
          h2: ({ children }) => <h2 className="mb-1 mt-2 text-sm font-semibold">{children}</h2>,
          h3: ({ children }) => <h3 className="mb-1 mt-2 text-sm font-semibold">{children}</h3>,
          code: ({ children }) => (
            <code className="rounded bg-foreground/10 px-1 py-0.5 font-mono text-[0.85em]">
              {children}
            </code>
          ),
          pre: ({ children }) => (
            <pre className="my-2 overflow-x-auto rounded-md bg-foreground/10 p-3 text-xs">
              {children}
            </pre>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-2 border-l-2 border-border pl-3 text-muted-foreground">
              {children}
            </blockquote>
          ),
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto rounded-md border">
              <table className="w-full border-collapse text-xs">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-muted/60">{children}</thead>,
          th: ({ children }) => (
            <th className="border-b px-2.5 py-1.5 text-left font-semibold">{children}</th>
          ),
          td: ({ children }) => (
            <td className="border-b px-2.5 py-1.5 align-top last:border-r-0">{children}</td>
          ),
          hr: () => <hr className="my-3 border-border" />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
