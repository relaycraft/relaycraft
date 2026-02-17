import { AnimatePresence, motion } from "framer-motion";
import { Brain, ChevronDown } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface AIMarkdownProps {
  content: string;
  className?: string;
}

export function AIMarkdown({ content, className = "" }: AIMarkdownProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Extract thinking process
  const { thoughts, answer, isThinking } = useMemo(() => {
    const thinkMatch = content.match(/<think>([\s\S]*?)(?:<\/think>|$)/);
    const thoughts = thinkMatch ? thinkMatch[1] : null;

    // The answer is everything after </think>, or if </think> isn't there, everything after <think> is thinking content
    let answer = content;
    const thinkEndIndex = content.indexOf("</think>");

    if (thinkEndIndex !== -1) {
      answer = content.substring(thinkEndIndex + 8).trim();
    } else if (content.includes("<think>")) {
      // Still thinking, no answer yet
      answer = "";
    }

    return {
      thoughts,
      answer,
      isThinking: content.includes("<think>") && !content.includes("</think>"),
    };
  }, [content]);

  // Auto-collapse when thinking is done and answer starts appearing
  useEffect(() => {
    if (answer.length > 0 && !isThinking) {
      setIsCollapsed(true);
    }
  }, [isThinking, answer]);

  return (
    <div
      className={`text-ui leading-relaxed text-foreground/90 font-medium prose-compact ${className}`}
    >
      <AnimatePresence>
        {thoughts && (
          <div className="mb-4 overflow-hidden border border-primary/10 rounded-xl bg-primary/[0.02]">
            <button
              type="button"
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="w-full flex items-center justify-between px-2.5 py-1.5 hover:bg-primary/5 transition-colors group"
            >
              <div className="flex items-center gap-3">
                <div className="p-1.5 bg-primary/10 rounded-lg group-hover:bg-primary/20 transition-colors">
                  <Brain
                    className={`w-3.5 h-3.5 text-primary/60 group-hover:text-primary ${isThinking ? "animate-pulse" : ""}`}
                  />
                </div>
                {isThinking && (
                  <div className="flex gap-1 ml-[-4px]">
                    <span className="w-1 h-1 rounded-full bg-primary/40 animate-bounce [animation-delay:-0.3s]" />
                    <span className="w-1 h-1 rounded-full bg-primary/40 animate-bounce [animation-delay:-0.15s]" />
                    <span className="w-1 h-1 rounded-full bg-primary/40 animate-bounce" />
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 pr-1">
                <ChevronDown
                  className={`w-3.5 h-3.5 text-primary/30 group-hover:text-primary/60 transition-transform duration-300 ${isCollapsed ? "-rotate-90" : ""}`}
                />
              </div>
            </button>

            <motion.div
              initial={false}
              animate={{
                height: isCollapsed ? 0 : "auto",
                opacity: isCollapsed ? 0 : 1,
              }}
              transition={{ duration: 0.3, ease: "easeInOut" }}
              className="overflow-hidden"
            >
              <div className="px-4 pb-4 pt-1 text-ui leading-relaxed text-foreground/60 italic font-normal border-t border-primary/5 bg-primary/[0.01] max-h-[260px] overflow-y-auto custom-scrollbar">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{thoughts}</ReactMarkdown>
                {isThinking && (
                  <motion.span
                    animate={{ opacity: [1, 0] }}
                    transition={{ duration: 0.8, repeat: Infinity }}
                    className="inline-block w-1 h-3 ml-1 bg-primary/40 align-middle"
                  />
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {answer && (
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            h1: ({ children }: any) => (
              <h1 className="text-base font-bold text-foreground mb-2 mt-2 flex items-center gap-2 border-b border-border/40 pb-1.5">
                {children}
              </h1>
            ),
            h2: ({ children }: any) => (
              <h2 className="text-sm font-bold text-foreground mb-2 mt-4 flex items-center gap-2">
                {children}
              </h2>
            ),
            h3: ({ children }: any) => (
              <h3 className="text-ui font-bold text-foreground/90 mb-1.5 mt-3">{children}</h3>
            ),
            p: ({ children }: any) => (
              <p className="mb-2 last:mb-0 leading-relaxed text-foreground/80">{children}</p>
            ),
            code: ({ children }: any) => (
              <code className="bg-primary/10 px-1.5 py-0.5 rounded text-ui font-mono border border-primary/20 text-primary font-medium">
                {children}
              </code>
            ),
            pre: ({ children }: any) => (
              <pre className="bg-muted/50 p-4 rounded-xl border border-border/40 my-3 overflow-x-auto no-scrollbar font-mono text-ui leading-relaxed select-all shadow-inner">
                {children}
              </pre>
            ),
            ul: ({ children }: any) => (
              <ul className="list-disc ml-6 space-y-2 mb-4 text-foreground/80">{children}</ul>
            ),
            ol: ({ children }: any) => (
              <ol className="list-decimal ml-6 space-y-2 mb-4 text-foreground/80">{children}</ol>
            ),
            li: ({ children }: any) => <li className="pl-1 leading-relaxed">{children}</li>,
            strong: ({ children }: any) => (
              <strong className="font-bold text-foreground">{children}</strong>
            ),
            blockquote: ({ children }: any) => (
              <div className="border-l-4 border-primary/30 bg-primary/5 p-4 rounded-r-xl my-4 italic shadow-sm flex flex-col gap-2 relative overflow-hidden text-xs">
                <div className="absolute top-0 right-0 w-16 h-16 bg-primary/5 blur-2xl -mr-8 -mt-8" />
                <div className="relative z-10 text-foreground/90 leading-relaxed">{children}</div>
              </div>
            ),
            hr: () => <hr className="my-6 border-border/40" />,
            table: ({ children }: any) => (
              <div className="my-4 overflow-x-auto rounded-xl border border-border/40 bg-white/[0.02]">
                <table className="w-full border-collapse text-ui font-sans">{children}</table>
              </div>
            ),
            thead: ({ children }: any) => <thead className="bg-muted/30">{children}</thead>,
            th: ({ children }: any) => (
              <th className="border-b border-border/40 px-3 py-2 text-left font-bold text-foreground/70 uppercase tracking-wider bg-white/[0.03] whitespace-nowrap">
                {children}
              </th>
            ),
            td: ({ children }: any) => (
              <td className="border-b border-border/20 px-3 py-2 text-foreground/80">{children}</td>
            ),
            tr: ({ children }: any) => (
              <tr className="hover:bg-white/[0.01] transition-colors last:child:border-0">
                {children}
              </tr>
            ),
          }}
        >
          {answer}
        </ReactMarkdown>
      )}
    </div>
  );
}
