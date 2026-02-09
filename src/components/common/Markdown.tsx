import ReactMarkdown from "react-markdown";
import { CodeBlock } from "./CodeBlock";

interface MarkdownProps {
  content: string;
  className?: string;
}

/**
 * A robust and high-density Markdown renderer.
 * Features smart inline/block detection to prevent layout breaks.
 */
export function Markdown({ content, className = "" }: MarkdownProps) {
  if (!content) return null;

  return (
    <div className={`overflow-y-auto h-full p-4 text-system bg-card/5 ${className}`}>
      <ReactMarkdown
        components={{
          // Smart Code Rendering
          code({ node, inline, className, children, ...props }: any) {
            const match = /language-(\w+)/.exec(className || "");
            const language = match ? match[1] : "";
            const codeString = String(children).replace(/\n$/, "");

            // Robustness: Only use CodeBlock if it's truly multi-line or has a language hint
            const isTrulyBlock = !inline && (codeString.includes("\n") || language !== "");

            if (isTrulyBlock) {
              return (
                <div className="my-3 first:mt-0 last:mb-0 rounded-lg overflow-hidden border border-border/40 shadow-sm bg-muted/20">
                  <CodeBlock
                    code={codeString}
                    language={language || "text"}
                    minimal
                    className="!p-3 !bg-transparent"
                  />
                </div>
              );
            }

            // Inline or short single-line code
            return (
              <code
                className="bg-primary/10 px-1.5 py-0.5 rounded text-[11px] font-mono text-primary font-bold mx-0.5"
                {...props}
              >
                {children}
              </code>
            );
          },
          // Vertical Density: Tight paragraphs
          p: ({ children }) => (
            <div className="mb-2 leading-relaxed text-foreground/90 last:mb-0">{children}</div>
          ),
          // Compact Headers
          h1: ({ children }) => (
            <h1 className="text-base font-bold mb-3 mt-5 first:mt-0 text-foreground border-b border-border/20 pb-1.5">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-sm font-bold mb-2 mt-4 first:mt-0 text-foreground">{children}</h2>
          ),
          // Dense Lists
          ul: ({ children }) => <ul className="list-disc pl-5 mb-2 space-y-0.5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-5 mb-2 space-y-0.5">{children}</ol>,
          li: ({ children }) => <li className="mb-0.5">{children}</li>,
          // Subtle Quotes
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-primary/30 pl-3 py-0.5 italic my-2 bg-primary/5 text-muted-foreground text-[12px]">
              {children}
            </blockquote>
          ),
          // Compact Tables
          table: ({ children }) => (
            <div className="overflow-x-auto my-3 border border-border/30 rounded-lg">
              <table className="w-full text-left border-collapse text-[12px]">{children}</table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-muted/40 border-b border-border/30">{children}</thead>
          ),
          th: ({ children }) => (
            <th className="px-3 py-1.5 font-bold uppercase text-[10px] tracking-wider opacity-60">
              {children}
            </th>
          ),
          td: ({ children }) => <td className="px-3 py-1 border-b border-border/10">{children}</td>,
          hr: () => <hr className="my-4 border-border/10" />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
