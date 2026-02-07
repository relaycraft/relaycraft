import { ConfirmationModal } from './ConfirmationModal';
import { useUIStore } from '../../stores/uiStore';

export function AlertDialog() {
    const { alertDialog, closeConfirm } = useUIStore();
    const { isOpen, title, message, confirmLabel, cancelLabel, variant, onConfirm, onCancel } = alertDialog;

    return (
        <ConfirmationModal
            isOpen={isOpen}
            onClose={closeConfirm}
            onConfirm={onConfirm}
            title={title}
            message={message}
            confirmLabel={confirmLabel}
            cancelLabel={cancelLabel}
            variant={variant}
            onCancel={onCancel}
        />
    );
}
