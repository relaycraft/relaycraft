import { useState, useEffect, useCallback } from 'react';
import {
    Shield,
    ShieldCheck,
    ChevronRight,
    Loader2,
    Check,
    AlertTriangle,
    Trash2,
    RefreshCw,
    FolderOpen,
    BookOpen,
    Clock,
    Fingerprint
} from 'lucide-react';
import { CopyButton } from '../common/CopyButton';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import { Button } from '../common/Button';
import { SettingsSection } from './SettingsLayout';
import { CertificateModal } from './CertificateModal';
import { cn } from '../../lib/utils';
import { Skeleton } from '../common/Skeleton';
import { motion, AnimatePresence } from 'framer-motion';

interface DetailedCertInfo {
    exists: boolean;
    subject?: string;
    issuer?: string;
    not_before?: string;
    not_after?: string;
    fingerprint?: string;
}

export function CertificateSettings() {
    const { t } = useTranslation();
    const [certInfo, setCertInfo] = useState<DetailedCertInfo | null>(null);
    const [certPath, setCertPath] = useState<string | null>(null);
    const [isInstalled, setIsInstalled] = useState<boolean | null>(null);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [modalOpen, setModalOpen] = useState(false);

    // Initial load tracking
    const [initialLoading, setInitialLoading] = useState(true);

    const loadCertInfo = useCallback(async (silent = false) => {
        if (!silent) setInitialLoading(true);
        setError(null);
        try {
            const [info, installed, path] = await Promise.all([
                invoke<DetailedCertInfo>('get_detailed_cert_info'),
                invoke<boolean>('check_cert_installed'),
                invoke<string>('get_cert_path').catch(() => null)
            ]);

            setCertInfo(info);
            setIsInstalled(installed);
            if (path) setCertPath(path);
        } catch (err) {
            console.error(err);
            if (!silent) setError(typeof err === 'string' ? err : t('common.loading') + ' ' + t('common.failed'));
        } finally {
            if (!silent) setInitialLoading(false);
        }
    }, [t]);

    useEffect(() => {
        loadCertInfo();
    }, [loadCertInfo]);

    const handleAction = async (action: string, fn: () => Promise<void>) => {
        setActionLoading(action);
        setError(null);
        try {
            await fn();
            await loadCertInfo(false); // Reload with skeleton to show "refreshing" feeling
        } catch (err) {
            console.error(err);
            const errorMsg = typeof err === 'string' ? err : `${action} ` + t('common.failed');

            // Special handling for macOS manual step requirement
            if (errorMsg.includes('MANUAL_STEP')) {
                setModalOpen(true);
                // Don't set error state, as this is an expected flow for macOS 15+
                return;
            }

            setError(errorMsg);
        } finally {
            setActionLoading(null);
        }
    };

    const handleInstallAutomated = () => handleAction('install', () => invoke('install_cert_automated'));
    const handleRemoveAutomated = () => handleAction('remove', () => invoke('remove_cert_automated'));
    const handleRegenerate = () => handleAction('regenerate', () => invoke('regenerate_root_ca'));

    const handleOpenCertDir = async () => {
        try {
            await invoke('open_cert_dir');
        } catch (err) {
            console.error(err);
        }
    };

    return (
        <>
            <SettingsSection title={t('sidebar.certificate')}>
                <div className="p-5 space-y-6">

                    {error && (
                        <div className="bg-destructive/10 border border-destructive/20 text-destructive px-4 py-3 rounded-xl text-sm flex items-center justify-between group animate-in fade-in slide-in-from-top-1">
                            <div className="flex items-center gap-2 font-medium">
                                <AlertTriangle className="w-4 h-4" />
                                {error}
                            </div>
                            <button onClick={() => setError(null)} className="opacity-50 hover:opacity-100 transition-opacity">
                                <Check className="w-4 h-4" />
                            </button>
                        </div>
                    )}

                    {/* Main Status & Info Card */}
                    <div className="bg-gradient-to-br from-card to-muted/20 border border-border rounded-2xl shadow-sm relative overflow-hidden">

                        <AnimatePresence mode="wait">
                            {initialLoading ? (
                                <motion.div
                                    key="skeleton"
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    transition={{ duration: 0.2 }}
                                    className="p-6"
                                >
                                    <div className="flex items-start gap-6">
                                        <Skeleton className="w-16 h-16 rounded-2xl flex-shrink-0" />
                                        <div className="flex-1 space-y-4">
                                            <div className="space-y-2">
                                                <Skeleton className="w-48 h-6 rounded-lg" />
                                                <Skeleton className="w-full max-w-md h-4 rounded-md opacity-60" />
                                            </div>
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-2">
                                                <Skeleton className="w-full h-12 rounded-xl" />
                                                <Skeleton className="w-full h-12 rounded-xl" />
                                            </div>
                                        </div>
                                    </div>
                                    <div className="pt-6 mt-6 border-t border-border/40 flex justify-between">
                                        <div className="flex gap-3">
                                            <Skeleton className="w-24 h-9 rounded-lg" />
                                            <Skeleton className="w-24 h-9 rounded-lg" />
                                        </div>
                                        <Skeleton className="w-32 h-9 rounded-lg" />
                                    </div>
                                </motion.div>
                            ) : (
                                <motion.div
                                    key="content"
                                    initial={{ opacity: 0, y: 5 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.3 }}
                                >
                                    {/* Content Header */}
                                    <div className="p-6 pb-2 sm:pb-6 flex flex-col sm:flex-row items-start gap-6">
                                        {/* Status Icon */}
                                        <div className={cn(
                                            "w-16 h-16 rounded-2xl flex items-center justify-center transition-all shadow-sm ring-1 ring-inset flex-shrink-0",
                                            isInstalled
                                                ? "bg-green-500/10 text-green-600 ring-green-500/20"
                                                : "bg-amber-500/10 text-amber-600 ring-amber-500/20"
                                        )}>
                                            {isInstalled ? <ShieldCheck className="w-8 h-8" /> : <Shield className="w-8 h-8" />}
                                        </div>

                                        {/* Main Text */}
                                        <div className="flex-1 min-w-0 space-y-4">
                                            <div className="space-y-1.5">
                                                <div className="flex items-center gap-3">
                                                    <h3 className="text-lg font-bold text-foreground">
                                                        {t('cert.ca_name')}
                                                    </h3>
                                                    <span className={cn(
                                                        "text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider border",
                                                        isInstalled
                                                            ? "bg-green-500/10 text-green-600 border-green-500/20"
                                                            : "bg-amber-500/10 text-amber-600 border-amber-500/20"
                                                    )}>
                                                        {isInstalled ? t('cert.status.trusted') : t('cert.status.untrusted')}
                                                    </span>
                                                </div>
                                                <p className="text-system text-muted-foreground leading-relaxed max-w-2xl">
                                                    {isInstalled
                                                        ? t('cert.state.trusted_desc')
                                                        : t('cert.state.untrusted_desc')
                                                    }
                                                </p>
                                            </div>

                                            {/* Info Grid */}
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                <div className="flex flex-col gap-1.5 p-3 rounded-xl bg-muted/30 border border-border/40">
                                                    <div className="flex items-center gap-2 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                                                        <Clock className="w-3 h-3" />
                                                        {t('cert.info.expires')}
                                                    </div>
                                                    <div className="font-mono text-xs font-medium pl-1 text-foreground/90">
                                                        {certInfo?.not_after || t('common.unknown')}
                                                    </div>
                                                </div>

                                                <div className="flex flex-col gap-1.5 p-3 rounded-xl bg-muted/30 border border-border/40">
                                                    <div className="flex items-center gap-2 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                                                        <Fingerprint className="w-3 h-3" />
                                                        {t('cert.info.fingerprint')} <span className="text-muted-foreground/50 font-normal normal-case ml-1">(SHA256)</span>
                                                    </div>
                                                    <div className="font-mono text-[10px] text-muted-foreground break-all leading-normal pl-1">
                                                        {certInfo?.fingerprint || t('common.not_loaded')}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Action Bar */}
                                    <div className="bg-muted/40 px-6 py-4 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-4">
                                        <div className="flex items-center gap-3 w-full sm:w-auto">
                                            {!isInstalled ? (
                                                <Button
                                                    onClick={handleInstallAutomated}
                                                    disabled={!!actionLoading}
                                                    className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm flex-1 sm:flex-none"
                                                    size="sm"
                                                >
                                                    {actionLoading === 'install' ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                                                    {t('cert.actions.install')}
                                                </Button>
                                            ) : (
                                                <Button
                                                    onClick={handleRemoveAutomated}
                                                    disabled={!!actionLoading}
                                                    variant="outline"
                                                    className="gap-2 text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/20 flex-1 sm:flex-none"
                                                    size="sm"
                                                >
                                                    {actionLoading === 'remove' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                                                    {t('cert.actions.remove')}
                                                </Button>
                                            )}

                                            <Button
                                                onClick={handleRegenerate}
                                                disabled={!!actionLoading}
                                                variant="ghost"
                                                className="gap-2 text-muted-foreground hover:text-foreground flex-1 sm:flex-none"
                                                size="sm"
                                            >
                                                {actionLoading === 'regenerate' ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                                                {t('cert.actions.regenerate')}
                                            </Button>
                                        </div>

                                        <Button
                                            onClick={() => setModalOpen(true)}
                                            variant="secondary"
                                            className="gap-2 text-xs font-bold bg-background hover:bg-muted border border-border/60 shadow-sm w-full sm:w-auto"
                                            size="sm"
                                        >
                                            <BookOpen className="w-4 h-4 text-primary max-sm:mr-1" />
                                            {t('cert.manual.guides.title')}
                                            <ChevronRight className="w-3.5 h-3.5 opacity-40 ml-1" />
                                        </Button>
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>

                    {/* Storage Location Card - Refined */}
                    <div className="bg-card border border-border rounded-xl p-1 pr-2 flex items-center gap-4 hover:shadow-sm transition-shadow group">
                        <div className="p-3 bg-muted/30 border-r border-border/40 rounded-l-xl text-muted-foreground group-hover:text-foreground transition-colors">
                            <FolderOpen className="w-5 h-5" />
                        </div>
                        <div className="flex-1 min-w-0 py-2">
                            <div className="text-xs font-bold text-foreground mb-1">{t('cert.storage.title')}</div>
                            <div className="text-[11px] text-muted-foreground/70 truncate font-mono">
                                {certPath || '—'}
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <CopyButton
                                text={certPath || ''}
                                variant="secondary"
                                className="h-8 w-8"
                            />
                            <Button
                                onClick={handleOpenCertDir}
                                variant="outline"
                                size="sm"
                                className="h-8 text-[11px] font-bold px-3 gap-1.5"
                            >
                                {t('cert.storage.open')}
                            </Button>
                        </div>
                    </div>
                </div>
            </SettingsSection>

            <CertificateModal
                isOpen={modalOpen}
                onClose={() => setModalOpen(false)}
            />
        </>
    );
}
