import { Code } from 'lucide-react';

interface CodeBlockProps {
    code: string;
    language: string;
    className?: string;
    preClassName?: string;
    hideHeader?: boolean;
    minimal?: boolean;
    preRef?: React.RefObject<HTMLPreElement | null>;
}

/**
 * A reusable CodeBlock component with syntax highlighting and professional header.
 */
export function CodeBlock({
    code,
    language,
    className = '',
    preClassName = '',
    hideHeader = false,
    minimal = false,
    preRef
}: CodeBlockProps) {
    // Utility for basic JSON syntax highlighting
    const highlightJson = (json: string) => {
        // First escape HTML special characters to prevent XSS and preserve structure
        const escaped = json
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        // Then apply highlighting to the already escaped string
        return escaped.replace(
            /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
            (match) => {
                let cls = 'text-blue-400'; // number
                if (/^"/.test(match)) {
                    if (/:$/.test(match)) {
                        cls = 'text-purple-400 font-bold'; // key
                    } else {
                        cls = 'text-green-400'; // string
                    }
                } else if (/true|false/.test(match)) {
                    cls = 'text-orange-400';
                } else if (/null/.test(match)) {
                    cls = 'text-gray-400 italic';
                }
                return `<span class="${cls}">${match}</span>`;
            }
        );
    };

    const isJson = language.toLowerCase() === 'json';
    const highlighted = isJson ? highlightJson(code) : code;

    const basePreClasses = "font-mono text-xs leading-relaxed m-0 scrollbar-thin scrollbar-thumb-primary/10 hover:scrollbar-thumb-primary/20 transition-colors whitespace-pre-wrap break-all";

    if (minimal) {
        return (
            <pre
                ref={preRef}
                className={`p-3 bg-muted/20 border border-border/40 rounded-lg ${basePreClasses} ${className} ${preClassName}`}
                dangerouslySetInnerHTML={isJson ? { __html: highlighted } : undefined}
            >
                {!isJson ? code : undefined}
            </pre>
        );
    }

    return (
        <div className={`group relative h-full min-h-[150px] border border-border/40 rounded-xl overflow-hidden bg-muted/5 backdrop-blur-sm flex flex-col ${className}`}>
            {/* Header/Title Bar */}
            {!hideHeader && (
                <div className="h-8 bg-muted/20 border-b border-border/40 flex items-center px-4 justify-between shrink-0">
                    <div className="flex items-center gap-2 text-muted-foreground/30">
                        <Code className="w-3.5 h-3.5" />
                        <span className="text-[10px] uppercase font-bold tracking-widest">{language}</span>
                    </div>
                </div>
            )}
            <div className="flex-1 flex flex-col min-h-0 p-2 overflow-hidden">
                <pre
                    ref={preRef}
                    className={`flex-1 overflow-auto rounded-lg p-6 pr-8 ${basePreClasses} ${preClassName}`}
                    dangerouslySetInnerHTML={isJson ? { __html: highlighted } : undefined}
                >
                    {!isJson ? code : undefined}
                </pre>
            </div>
        </div>
    );
}
