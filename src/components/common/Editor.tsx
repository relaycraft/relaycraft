import CodeMirror from '@uiw/react-codemirror';
import { json } from '@codemirror/lang-json';
import { python } from '@codemirror/lang-python';
import { yaml } from '@codemirror/lang-yaml';
import { javascript } from '@codemirror/lang-javascript';
import { EditorView } from '@codemirror/view';
import { Extension } from '@codemirror/state';
import { unifiedMergeView } from '@codemirror/merge';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { useMemo } from 'react';
import { useThemeStore } from '../../stores/themeStore';



/**
 * Creates a RelayCraft Premium syntax highlighting style
 * Uses semantic CSS variables for 100% theme awareness
 */
const createPremiumHighlightStyle = (): HighlightStyle => {
    return HighlightStyle.define([
        { tag: t.keyword, color: 'var(--syntax-keyword)', fontWeight: 'bold' },
        { tag: t.operator, color: 'var(--syntax-operator)' },
        { tag: t.string, color: 'var(--syntax-string)' },
        { tag: t.number, color: 'var(--syntax-constant)' },
        { tag: t.bool, color: 'var(--syntax-constant)' },
        { tag: t.null, color: 'var(--syntax-constant)' },
        { tag: t.atom, color: 'var(--syntax-constant)' },
        { tag: t.variableName, color: 'var(--syntax-variable)' },
        { tag: t.propertyName, color: 'var(--syntax-property)' },
        { tag: t.comment, color: 'var(--syntax-comment)', fontStyle: 'italic' },
        { tag: t.function(t.variableName), color: 'var(--syntax-function)' },
        { tag: t.className, color: 'var(--syntax-function)' },
        { tag: t.bracket, color: 'var(--syntax-variable)' },
        { tag: t.punctuation, color: 'var(--syntax-comment)' },
        { tag: t.attributeName, color: 'var(--syntax-constant)' },
        { tag: t.heading, color: 'var(--syntax-keyword)', fontWeight: 'bold' },
    ]);
};

/**
 * Creates a RelayCraft Premium theme extension for CodeMirror 6
 */
const createPremiumTheme = (isDark: boolean, bgColor: string, fgColor: string, fontMono: string): Extension => {
    return EditorView.theme({
        '&': {
            backgroundColor: bgColor,
            color: fgColor,
            height: '100% !important',
            display: 'flex !important',
            flexDirection: 'column',
            overflow: 'hidden !important',
        },
        '.cm-editor': {
            flex: '1',
            display: 'flex !important',
            flexDirection: 'column',
            height: '100% !important',
            minHeight: '0',
            overflow: 'hidden !important',
        },
        '.cm-scroller': {
            fontFamily: `${fontMono} !important`,
            lineHeight: '1.6',
            fontSize: '13px',
            fontVariantLigatures: 'common-ligatures',
            fontFeatureSettings: '"liga" 1, "calt" 1',
            flex: '1',
            overflow: 'auto !important',
            minHeight: '0',
            maxHeight: '100%',
            minWidth: '0',
            overscrollBehavior: 'contain',
        },
        '.cm-content': {
            caretColor: 'var(--color-primary)',
            padding: '10px 0',
        },
        '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--color-primary)' },
        '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
            backgroundColor: 'color-mix(in srgb, var(--color-primary), transparent 85%)',
        },
        '.cm-gutters': {
            backgroundColor: 'transparent',
            color: 'var(--syntax-gutter)',
            border: 'none',
        },
        '.cm-activeLineGutter': {
            backgroundColor: 'transparent',
            color: 'var(--color-primary)',
        },
        '.cm-activeLine': { backgroundColor: 'transparent' },
        '.cm-foldPlaceholder': {
            backgroundColor: 'transparent',
            border: 'none',
            color: 'var(--syntax-comment)',
        },
        // Scrollbar styling matching the app's "Zen" 6px profile
        '& ::-webkit-scrollbar': {
            width: '6px',
            height: '6px',
        },
        '& ::-webkit-scrollbar-track': {
            background: 'transparent',
        },
        '& ::-webkit-scrollbar-thumb': {
            background: 'color-mix(in srgb, var(--color-foreground), transparent 90%)',
            borderRadius: '4px',
        },
        '& ::-webkit-scrollbar-thumb:hover': {
            background: 'color-mix(in srgb, var(--color-foreground), transparent 80%)',
        },
    }, { dark: isDark });
};

export const Editor = (props: any) => {
    const { activeThemeId, themes } = useThemeStore();
    const theme = useMemo(() => themes.find(t => t.id === activeThemeId), [activeThemeId, themes]);
    const isDark = theme?.type !== 'light';

    // Theme values derived purely from variables
    const bgColor = useMemo(() => theme?.colors['--color-card'] || 'var(--color-card)', [theme]);
    const fgColor = useMemo(() => theme?.colors['--color-foreground'] || 'var(--color-foreground)', [theme]);
    const fontMono = useMemo(() => theme?.colors['--font-mono'] || 'var(--font-mono)', [theme]);

    const extensions = useMemo(() => {
        const exts: Extension[] = [
            createPremiumTheme(isDark, bgColor, fgColor, fontMono),
            syntaxHighlighting(createPremiumHighlightStyle())
        ];

        if (props.language === 'json') exts.push(json());
        if (props.language === 'python') exts.push(python());
        if (props.language === 'yaml') exts.push(yaml());
        if (props.language === 'javascript' || props.language === 'typescript') {
            exts.push(javascript({ jsx: true, typescript: props.language === 'typescript' }));
        }

        // Basic settings based on common Monaco props
        if (props.options?.readOnly) exts.push(EditorView.editable.of(false));
        if (props.options?.lineWrapping) exts.push(EditorView.lineWrapping);

        return exts;
    }, [isDark, bgColor, fgColor, props.language, props.options]);

    return (
        <div
            className="relaycraft-editor-host"
            style={{ width: '100%', height: '100%', overflow: 'hidden', borderRadius: 'inherit', position: 'relative' }}
        >
            <CodeMirror
                value={props.value}
                height="100%"
                className="relaycraft-cm6-wrapper"
                style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
                theme="none" // We use our custom extension
                extensions={extensions}
                onChange={(value) => props.onChange && props.onChange(value)}
                basicSetup={{
                    lineNumbers: props.options?.lineNumbers !== 'off',
                    foldGutter: true,
                    dropCursor: true,
                    allowMultipleSelections: true,
                    indentOnInput: true,
                    syntaxHighlighting: true,
                    bracketMatching: true,
                    closeBrackets: true,
                    autocompletion: true,
                    rectangularSelection: true,
                    crosshairCursor: true,
                    highlightActiveLine: false,
                    highlightSelectionMatches: true,
                    closeBracketsKeymap: true,
                    defaultKeymap: true,
                    searchKeymap: true,
                    historyKeymap: true,
                    foldKeymap: true,
                    completionKeymap: true,
                    lintKeymap: true,
                }}
                {...props}
            />
        </div>
    );
};

export const DiffEditor = (props: any) => {
    const { activeThemeId, themes } = useThemeStore();
    const theme = useMemo(() => themes.find(t => t.id === activeThemeId), [activeThemeId, themes]);
    const isDark = theme?.type !== 'light';

    // Theme values derived purely from variables
    const bgColor = useMemo(() => theme?.colors['--color-card'] || 'var(--color-card)', [theme]);
    const fgColor = useMemo(() => theme?.colors['--color-foreground'] || 'var(--color-foreground)', [theme]);
    const fontMono = useMemo(() => theme?.colors['--font-mono'] || 'var(--font-mono)', [theme]);

    const extensions = useMemo(() => {
        const exts: Extension[] = [
            createPremiumTheme(isDark, bgColor, fgColor, fontMono),
            syntaxHighlighting(createPremiumHighlightStyle()),
            unifiedMergeView({
                original: props.original || '',
                mergeControls: false,
                highlightChanges: true,
                gutter: true,
            })
        ];

        if (props.language === 'json') exts.push(json());
        if (props.language === 'python') exts.push(python());
        if (props.language === 'yaml') exts.push(yaml());

        exts.push(EditorView.editable.of(false));

        return exts;
    }, [isDark, bgColor, fgColor, props.language, props.original]);

    // For Diff, we use a slightly different rendering strategy with Merge view
    return (
        <div
            className="cm-diff-editor-container"
            style={{ width: '100%', height: '100%', overflow: 'hidden', borderRadius: 'inherit' }}
        >
            <style>{`
                .cm-diff-editor-container .cm-mergeView { height: 100%; display: flex; flex-direction: column; }
                .cm-diff-editor-container .cm-mergeViewEditor { flex: 1; overflow: auto; }
                /* Hide indicators like Monaco had */
                .cm-deleted {
                    background-color: color-mix(in srgb, var(--color-destructive), transparent 85%) !important;
                    border-left: 2px solid var(--color-destructive);
                }
                .cm-inserted {
                    background-color: color-mix(in srgb, var(--color-primary), transparent 85%) !important;
                    border-left: 2px solid var(--color-primary);
                }
            `}</style>
            <CodeMirror
                value={props.modified || props.value}
                height="100%"
                theme="none"
                extensions={extensions}
                basicSetup={{
                    lineNumbers: true,
                    syntaxHighlighting: true,
                    highlightActiveLine: false,
                }}
            />
        </div>
    );
};

// Compatibility exports for loader/useMonaco
export const loader = {
    config: () => { },
    init: () => Promise.resolve()
};

export const useMonaco = () => null;
