import {
    Server,
    Puzzle,
    Code,
    Network,
    Download,
    Shield,
    AlertCircle,
    AlertTriangle,
    Info,
    CheckCircle
} from 'lucide-react';
import { NotificationCategory, NotificationPriority } from '../../stores/notificationStore';
import i18n from '../../i18n';
import { useTranslation } from 'react-i18next';

interface CategoryBadgeProps {
    category: NotificationCategory;
    className?: string;
}

export function NotificationCategoryBadge({ category, className = '' }: CategoryBadgeProps) {
    const { t } = useTranslation();
    const config = getCategoryConfig(category);
    const Icon = config.icon;

    return (
        <div
            className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-medium border ${className}`}
            style={{
                backgroundColor: `color-mix(in srgb, ${config.color}, transparent 90%)`,
                color: config.color,
                borderColor: `color-mix(in srgb, ${config.color}, transparent 80%)`
            }}
            title={t(config.label)}
        >
            <Icon className="w-3 h-3" />
            <span>{t(config.label)}</span>
        </div>
    );
}

export function getCategoryConfig(category: NotificationCategory) {
    const configs = {
        system: {
            label: 'notifications.category.system',
            icon: Server,
            color: 'var(--color-primary)'
        },
        plugin: {
            label: 'notifications.category.plugin',
            icon: Puzzle,
            color: 'var(--color-info)'
        },
        script: {
            label: 'notifications.category.script',
            icon: Code,
            color: 'var(--color-primary)'
        },
        network: {
            label: 'notifications.category.network',
            icon: Network,
            color: 'var(--color-success)'
        },
        update: {
            label: 'notifications.category.update',
            icon: Download,
            color: 'var(--color-warning)'
        },
        security: {
            label: 'notifications.category.security',
            icon: Shield,
            color: 'var(--color-destructive)'
        }
    };

    return configs[category];
}

export function getPriorityConfig(priority: NotificationPriority) {
    const configs = {
        critical: {
            label: 'notifications.priority.critical',
            icon: AlertCircle,
            className: 'border-destructive/50 bg-destructive/5',
            iconClassName: 'text-destructive',
            color: 'var(--color-destructive)',
            shouldPulse: true
        },
        high: {
            label: 'notifications.priority.high',
            icon: AlertTriangle,
            className: 'border-warning/50 bg-warning/5',
            iconClassName: 'text-warning',
            color: 'var(--color-warning)',
            shouldPulse: false
        },
        normal: {
            label: 'notifications.priority.normal',
            icon: CheckCircle,
            className: 'border-border/40 bg-card',
            iconClassName: 'text-success',
            color: 'var(--color-success)',
            shouldPulse: false
        },
        low: {
            label: 'notifications.priority.low',
            icon: Info,
            className: 'border-border/30 bg-muted/10',
            iconClassName: 'text-muted-foreground/60',
            color: 'var(--color-muted-foreground)',
            shouldPulse: false
        }
    };

    return configs[priority];
}

export function formatRelativeTime(timestamp: number): string {
    const now = Date.now();
    const diff = now - timestamp;

    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (seconds < 60) return i18n.t('notifications.relative_time.just_now');
    if (minutes < 60) return i18n.t('notifications.relative_time.minutes_ago', { count: minutes });
    if (hours < 24) return i18n.t('notifications.relative_time.hours_ago', { count: hours });
    if (days < 7) return i18n.t('notifications.relative_time.days_ago', { count: days });

    return new Date(timestamp).toLocaleDateString(i18n.language, {
        month: 'short',
        day: 'numeric'
    });
}
