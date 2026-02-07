import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import { NotificationItem } from '../../stores/notificationStore';
import { getCategoryConfig, getPriorityConfig, formatRelativeTime } from './NotificationHelpers';
import { Button } from '../common/Button';
import { useTranslation } from 'react-i18next';

interface NotificationItemCardProps {
    notification: NotificationItem;
    onMarkAsRead: (id: string) => void;
    onRemove: (id: string) => void;
}

export function NotificationItemCard({ notification, onMarkAsRead, onRemove }: NotificationItemCardProps) {
    const { t } = useTranslation();
    // 提供默认值以支持旧通知
    const category = notification.category || 'system';
    const priority = notification.priority || 'normal';

    const priorityConfig = getPriorityConfig(priority);
    const categoryConfig = getCategoryConfig(category);
    const PriorityIcon = priorityConfig.icon;
    const CategoryIcon = categoryConfig.icon;

    return (
        <motion.div
            layout
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className={`relative group p-3.5 rounded-xl border transition-all cursor-pointer ${notification.read
                ? 'bg-muted/5 border-border/10 opacity-60 hover:opacity-100'
                : `${priorityConfig.className} shadow-sm border-border/40 hover:border-border/60`
                } ${priorityConfig.shouldPulse && !notification.read ? 'animate-pulse' : ''}`}
            onClick={() => onMarkAsRead(notification.id)}
        >
            <div className="flex items-start gap-3">
                {/* 图标 */}
                <div className={`mt-0.5 shrink-0 ${priorityConfig.shouldPulse && !notification.read ? 'animate-pulse' : ''}`}>
                    <PriorityIcon className={`w-5 h-5 ${priorityConfig.iconClassName}`} />
                </div>

                {/* 内容 */}
                <div className="flex-1 min-w-0 space-y-1.5">
                    {/* 标题和时间 */}
                    <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0 pr-6">
                            {!notification.read && (
                                <div
                                    className="w-1.5 h-1.5 rounded-full shrink-0"
                                    style={{ backgroundColor: priorityConfig.color }}
                                />
                            )}
                            <h4 className={`text-system font-semibold leading-snug truncate ${notification.read ? 'text-muted-foreground' : 'text-foreground'
                                }`}>
                                {notification.title}
                            </h4>
                        </div>
                    </div>

                    {/* 消息内容 */}
                    {notification.message && (
                        <p className="text-[11px] text-muted-foreground/80 leading-relaxed line-clamp-2">
                            {notification.message}
                        </p>
                    )}

                    {/* 底部信息 */}
                    <div className="flex items-center gap-2 pt-0.5">
                        {/* 分类徽章 */}
                        <div className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-muted/40 text-muted-foreground/70 border border-border/10">
                            <CategoryIcon className="w-2.5 h-2.5 opacity-60" />
                            <span>{t(categoryConfig.label)}</span>
                        </div>

                        {/* 来源 (If different from title and present) */}
                        {notification.source && notification.source !== notification.title && (
                            <>
                                <span className="text-border/40">|</span>
                                <span className="text-[10px] text-muted-foreground/40 font-medium truncate max-w-[150px]">
                                    {notification.source.replace('Plugin: ', '')}
                                </span>
                            </>
                        )}

                        {/* 时间 */}
                        <span className="text-border/40">|</span>
                        <span className="text-[10px] text-muted-foreground/40 tabular-nums">
                            {formatRelativeTime(notification.timestamp)}
                        </span>
                    </div>

                    {/* 操作按钮 */}
                    {notification.actions && notification.actions.length > 0 && (
                        <div className="flex items-center gap-2 pt-1">
                            {notification.actions.map((action, index) => (
                                <Button
                                    key={index}
                                    variant={action.variant === 'danger' ? 'destructive' : action.variant === 'primary' ? 'default' : 'outline'}
                                    size="xs"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        action.onClick();
                                    }}
                                    className="h-6 text-[10px]"
                                >
                                    {action.label}
                                </Button>
                            ))}
                        </div>
                    )}
                </div>

                {/* 删除按钮 */}
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onRemove(notification.id);
                    }}
                    className="absolute top-2 right-2 p-1 rounded-md hover:bg-destructive/10 hover:text-destructive text-muted-foreground/30 opacity-0 group-hover:opacity-100 transition-all"
                    title={t('notifications.delete_title')}
                >
                    <X className="w-3.5 h-3.5" />
                </button>
            </div>
        </motion.div>
    );
}
