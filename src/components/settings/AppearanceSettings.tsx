import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useThemeStore, ThemeMode } from '../../stores/themeStore';
import { usePluginStore } from '../../stores/pluginStore';
import { useUIStore } from '../../stores/uiStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { SettingsSection } from './SettingsLayout';
import { ThemeThumbnail } from './ThemeThumbnail';
import { Button } from '../common/Button';
import { Plus, Sun, Moon, Monitor, Palette, Globe } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';

export const AppearanceSettings: React.FC = () => {
    const { t } = useTranslation();
    const {
        themes,
        activeThemeId,
        themeMode,
        setThemeMode,
        setTheme,
        fetchThemes,
        deleteTheme
    } = useThemeStore();
    const { installPluginLocal } = usePluginStore();
    const { setMarketOpen } = useUIStore();
    const {
        config,
        updateDisplayDensity
    } = useSettingsStore();

    useEffect(() => {
        fetchThemes();
    }, [fetchThemes]);

    const handleImportTheme = async () => {
        const selected = await open({
            multiple: false,
            filters: [{ name: 'RelayCraft Theme', extensions: ['rctheme', 'zip'] }]
        });
        if (selected && typeof selected === 'string') {
            await installPluginLocal(selected);
        }
    };

    const modes: { id: ThemeMode; icon: any; label: string }[] = [
        { id: 'light', icon: Sun, label: t('settings.appearance.mode_light') },
        { id: 'dark', icon: Moon, label: t('settings.appearance.mode_dark') },
        { id: 'system', icon: Monitor, label: t('settings.appearance.mode_system') },
        { id: 'custom', icon: Palette, label: t('settings.appearance.mode_custom') },
    ];

    const [themeToDelete, setThemeToDelete] = React.useState<string | null>(null);

    return (
        <div className="space-y-6">
            <SettingsSection title={t('settings.appearance.theme')}>
                <div className="p-4 space-y-6">
                    {/* Mode Selector */}
                    <div className="grid grid-cols-4 gap-2">
                        {modes.map((mode) => {
                            const Icon = mode.icon;
                            const isActive = themeMode === mode.id;
                            return (
                                <button
                                    key={mode.id}
                                    onClick={() => setThemeMode(mode.id)}
                                    className={`flex flex-col items-center gap-2 p-3 rounded-xl border transition-all ${isActive
                                        ? 'bg-primary/10 border-primary text-primary shadow-sm'
                                        : 'bg-muted/10 border-transparent text-muted-foreground hover:bg-muted/20 hover:text-foreground'
                                        }`}
                                >
                                    <Icon className="w-4 h-4" />
                                    <span className="text-[11px] font-semibold uppercase">{mode.label}</span>
                                </button>
                            );
                        })}
                    </div>

                    {/* Theme Grid (Visible only in Custom mode or always?) */}
                    {/* User asked for Theme Thumbnails, let's show them if mode is custom or just show them anyway but with 'Custom' header */}
                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">
                                {t('settings.appearance.mode_custom')}
                            </h4>
                            <div className="flex gap-2">
                                <Button
                                    variant="ghost"
                                    size="xs"
                                    className="h-7 text-[10px] gap-1.5"
                                    onClick={handleImportTheme}
                                >
                                    <Plus className="w-3 h-3" />
                                    {t('settings.appearance.import_zip')}
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="xs"
                                    className="h-7 text-[10px] gap-1.5"
                                    onClick={() => setMarketOpen(true, 'theme')}
                                >
                                    <Globe className="w-3 h-3" />
                                    {t('settings.appearance.market_btn')}
                                </Button>
                            </div>
                        </div>

                        <div className="grid grid-cols-3 gap-3">
                            {themes.filter(t => t.pluginId !== 'system').length > 0 ? (
                                themes.filter(t => t.pluginId !== 'system').map((theme) => (
                                    <ThemeThumbnail
                                        key={theme.id}
                                        theme={theme}
                                        isActive={themeMode === 'custom' && activeThemeId === theme.id}
                                        onClick={() => setTheme(theme.id)}
                                        onDelete={() => {
                                            setThemeToDelete(theme.id);
                                        }}
                                    />
                                ))
                            ) : (
                                <div className="col-span-3 py-6 px-5 border border-border rounded-xl bg-gradient-to-br from-muted/30 to-muted/10 flex items-center justify-between group cursor-pointer hover:border-primary/20 transition-all"
                                    onClick={() => setMarketOpen(true, 'theme')}
                                >
                                    <div className="space-y-1.5">
                                        <h4 className="text-sm font-semibold text-foreground flex items-center gap-2 group-hover:text-primary transition-colors">
                                            <Palette className="w-4 h-4" />
                                            {t('settings.appearance.discover_themes_title')}
                                        </h4>
                                        <p className="text-[11px] text-muted-foreground max-w-[200px] leading-relaxed">
                                            {t('settings.appearance.discover_themes_desc')}
                                        </p>
                                    </div>
                                    <Button size="sm" className="h-8 text-xs shadow-sm hover:shadow-md transition-all">
                                        {t('settings.appearance.market_btn')}
                                        <Globe className="w-3.5 h-3.5 ml-2" />
                                    </Button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </SettingsSection>

            <SettingsSection
                title={t('settings.appearance.density')}
            >
                <div className="p-4 flex gap-2">
                    {['compact', 'comfortable', 'relaxed'].map((d) => (
                        <Button
                            key={d}
                            variant={config.display_density === d ? 'default' : 'ghost'}
                            size="sm"
                            className={`flex-1 text-[11px] font-semibold h-9 transition-all duration-200 ${config.display_density === d
                                ? 'shadow-md border border-primary/20'
                                : 'bg-muted/10 border border-transparent hover:bg-primary/10 hover:border-primary/20 hover:text-primary'
                                }`}
                            onClick={() => updateDisplayDensity(d as any)}
                        >
                            {t(`settings.appearance.density_${d}`)}
                        </Button>
                    ))}
                </div>
            </SettingsSection>

            {/* Delete Confirmation Dialog */}
            {themeToDelete && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 backdrop-blur-[1px]">
                    <div className="bg-popover border border-border rounded-xl shadow-lg p-6 max-w-sm w-full space-y-4 animate-in fade-in zoom-in-95 duration-200">
                        <div className="space-y-2">
                            <h3 className="text-lg font-semibold leading-none tracking-tight">
                                {t('common.confirm_delete_title')}
                            </h3>
                            <p className="text-sm text-muted-foreground">
                                {t('common.confirm_delete_desc')}
                            </p>
                        </div>
                        <div className="flex justify-end gap-2 pt-2">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setThemeToDelete(null)}
                            >
                                {t('common.cancel')}
                            </Button>
                            <Button
                                variant="destructive"
                                size="sm"
                                onClick={async () => {
                                    if (themeToDelete) {
                                        await deleteTheme(themeToDelete);
                                        setThemeToDelete(null);
                                    }
                                }}
                            >
                                {t('common.delete')}
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
