import { Search, X, Regex as RegexIcon, ListFilter, HelpCircle } from 'lucide-react';
import { Tooltip } from '../common/Tooltip';
import { AIAssistant } from '../ai/AIAssistant';
import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Input } from '../common/Input';
import { Button } from '../common/Button';

interface FilterBarProps {
    filterText: string;
    setFilterText: (text: string) => void;
    isRegex: boolean;
    setIsRegex: (val: boolean) => void;
    caseSensitive: boolean;
    setCaseSensitive: (val: boolean) => void;
    onlyMatched: boolean;
    setOnlyMatched: (val: boolean) => void;
    filteredCount: number;
    totalCount: number;
}
// Props definition for FilterBar

export function FilterBar({
    filterText,
    setFilterText,
    isRegex,
    setIsRegex,
    caseSensitive,
    setCaseSensitive,
    onlyMatched,
    setOnlyMatched,
    filteredCount,
    totalCount
}: FilterBarProps) {
    const { t } = useTranslation();
    const [showHelp, setShowHelp] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const handleFocus = () => {
            inputRef.current?.focus();
        };

        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
                e.preventDefault();
                handleFocus();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('focus-traffic-search', handleFocus);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('focus-traffic-search', handleFocus);
        };
    }, []);

    const appendFilter = (prefix: string) => {
        if (filterText && !filterText.endsWith(' ')) {
            setFilterText(`${filterText} ${prefix}`);
        } else {
            setFilterText(`${filterText}${prefix}`);
        }
    };
    return (
        <div className="p-3 flex-shrink-0 z-50 relative flex flex-col gap-2 bg-muted/15 backdrop-blur-xl border-b border-border/40">
            <div className="flex items-center gap-2">
                <div className="relative flex-1 group">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground group-focus-within:text-primary transition-colors z-10" />
                    <Input
                        ref={inputRef}
                        type="text"
                        value={filterText}
                        onChange={(e) => setFilterText(e.target.value)}
                        placeholder={t('traffic.filter.placeholder')}
                        className="pl-9 pr-20 bg-background text-system placeholder:text-xs placeholder:text-muted-foreground/60"
                    />

                    {/* Right-side Actions inside input */}
                    <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 z-10">
                        <AIAssistant
                            mode="filter"
                            onGenerate={(result) => {
                                setFilterText(result);
                            }}
                        />
                        {filterText && (
                            <Button
                                variant="ghost"
                                size="icon-xs"
                                onClick={() => setFilterText('')}
                                className="h-5 w-5 rounded-full hover:bg-muted"
                            >
                                <X className="w-3 h-3 text-muted-foreground" />
                            </Button>
                        )}
                        <div className="w-px h-3 bg-border mx-0.5" />
                        <Tooltip content={t('common.help')} side="bottom">
                            <Button
                                variant="ghost"
                                size="icon-xs"
                                onClick={() => setShowHelp(!showHelp)}
                                className={`h-6 w-6 rounded-md ${showHelp ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                            >
                                <HelpCircle className="w-3.5 h-3.5" />
                            </Button>
                        </Tooltip>
                    </div>
                </div>

                {/* Toggles */}
                <div className="flex items-center border border-border rounded-lg bg-background p-0.5 shadow-sm">
                    <Tooltip content={t('traffic.filter.regex_tooltip')} side="bottom">
                        <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => setIsRegex(!isRegex)}
                            className={`h-7 w-7 rounded-md ${isRegex
                                ? 'bg-primary/10 text-primary hover:bg-primary/20 hover:text-primary'
                                : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
                        >
                            <RegexIcon className="w-3.5 h-3.5" />
                        </Button>
                    </Tooltip>
                    <div className="w-px h-3 bg-border mx-0.5" />
                    <Tooltip content={t('traffic.filter.case_tooltip')} side="bottom">
                        <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => setCaseSensitive(!caseSensitive)}
                            className={`h-7 w-7 rounded-md ${caseSensitive
                                ? 'bg-primary/10 text-primary hover:bg-primary/20 hover:text-primary'
                                : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
                        >
                            <div className="w-3.5 h-3.5 flex items-center justify-center font-bold text-[10px]">Aa</div>
                        </Button>
                    </Tooltip>
                    <div className="w-px h-3 bg-border mx-0.5" />
                    <Tooltip content={t('traffic.filter.matched_tooltip')} side="bottom">
                        <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => setOnlyMatched(!onlyMatched)}
                            className={`h-7 w-7 rounded-md ${onlyMatched
                                ? 'bg-purple-500/10 text-purple-600 hover:bg-purple-500/20 hover:text-purple-700'
                                : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
                        >
                            <ListFilter className="w-3.5 h-3.5" />
                        </Button>
                    </Tooltip>
                </div>

                {/* Count Badge */}
                <div className="hidden sm:flex items-center px-2 py-1 bg-muted/30 border border-border/50 rounded-md text-[10px] font-mono text-muted-foreground whitespace-nowrap tabular-nums z-10">
                    <span className={filterText ? "text-primary font-bold" : ""}>{filteredCount}</span>
                    <span className="opacity-40 mx-1">/</span>
                    <span className="opacity-60">{totalCount}</span>
                </div>
            </div>

            {/* Advanced Filters Help / Quick Chips */}
            <AnimatePresence>
                {showHelp && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden"
                    >
                        <div className="bg-muted/50 rounded-lg p-2 text-xs border border-border/50 text-muted-foreground">
                            <div className="flex flex-wrap items-center gap-2 mb-2">
                                <span className="font-semibold text-foreground">{t('traffic.filter.quick')}:</span>
                                {['method:POST', 'status:4xx', 'type:json', 'h:cookie', 'body:error', 's:>1mb', 'dur:>500ms', '-domain:google'].map(filter => (
                                    <button
                                        key={filter}
                                        onClick={() => appendFilter(filter)}
                                        className="px-1.5 py-0.5 bg-background border border-border rounded hover:border-primary/50 hover:text-primary transition-colors cursor-pointer"
                                    >
                                        {filter}
                                    </button>
                                ))}
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1 opacity-80">
                                <div>• <b>{t('traffic.filter.and')}</b>: {t('traffic.filter.and_desc')} <span className="opacity-60 text-[11px]">(e.g. method:POST type:json)</span></div>
                                <div>• <b>{t('traffic.filter.or')}</b>: {t('traffic.filter.or_desc')} <span className="opacity-60 text-[11px]">(e.g. status:4xx status:5xx)</span></div>
                                <div>• <b>{t('traffic.filter.neg')}</b> <span className="opacity-60 text-[11px]">(e.g. -domain:google)</span></div>
                                <div>• <b>{t('traffic.filter.compare')}</b> <span className="opacity-60 text-[11px]">(e.g. size:&gt;1mb)</span></div>
                                <div>• <b>{t('traffic.filter.headers')}</b> <span className="opacity-60 text-[11px]">(e.g. h:ua:mozilla)</span></div>
                                <div>• <b>{t('traffic.filter.body')}</b> <span className="opacity-60 text-[11px]">(e.g. body:error)</span></div>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
