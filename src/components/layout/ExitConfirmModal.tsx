import { useTranslation } from 'react-i18next';
import { ConfirmationModal } from '../common/ConfirmationModal';
import { LogOut } from 'lucide-react';

interface ExitConfirmModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
}

export function ExitConfirmModal({ isOpen, onClose, onConfirm }: ExitConfirmModalProps) {
    const { t } = useTranslation();

    return (
        <ConfirmationModal
            isOpen={isOpen}
            onClose={onClose}
            onConfirm={onConfirm}
            variant="warning"
            title={t('settings.appearance.exit_confirm_title')}
            message={t('settings.appearance.exit_confirm_message')}
            confirmLabel={t('settings.appearance.exit_confirm_title')}
            cancelLabel={t('common.cancel')}
            customIcon={<LogOut className="w-4 h-4 text-orange-500" />}
        />
    );
}
