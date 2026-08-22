import { useUIStore } from "../../stores/uiStore";
import { ConfirmationModal } from "./ConfirmationModal";

export function AlertDialog() {
  const { alertDialog, closeConfirm, setConfirmCheckbox } = useUIStore();
  const {
    isOpen,
    title,
    message,
    confirmLabel,
    cancelLabel,
    variant,
    onConfirm,
    onCancel,
    customIcon,
    checkboxLabel,
    checkboxChecked,
  } = alertDialog;

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
      customIcon={customIcon}
      checkboxLabel={checkboxLabel}
      checkboxChecked={checkboxChecked}
      onCheckboxChange={setConfirmCheckbox}
    />
  );
}
