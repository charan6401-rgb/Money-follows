import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useI18n } from '@/lib/i18n/useI18n';
import { errorMessageKey } from '@/lib/errors';
import { Button } from '@/components/ui/Button';
import { TextAreaField } from '@/components/ui/Field';

interface ConfirmSheetProps {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  /** Ask for a reason (3 to 300 characters) before confirming. */
  reasonLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  error?: unknown;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}

/**
 * A bottom sheet on phones and a centred dialog on wider screens, built on the native
 * <dialog> element so focus trapping, Escape and the backdrop come from the browser.
 */
export function ConfirmSheet({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel,
  reasonLabel,
  destructive = false,
  busy = false,
  error,
  onConfirm,
  onClose,
}: ConfirmSheetProps) {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setReason('');
      setTouched(false);
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const trimmed = reason.trim();
  const reasonInvalid = reasonLabel !== undefined && (trimmed.length < 3 || trimmed.length > 300);

  const submit = () => {
    setTouched(true);
    if (reasonInvalid || busy) return;
    onConfirm(trimmed);
  };

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(event) => {
        if (busy) event.preventDefault();
      }}
      aria-labelledby="confirm-sheet-title"
      className="m-0 mt-auto w-full max-w-none md:m-auto md:max-w-md"
    >
      <div className="sheet-enter rounded-t-sheet bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-sheet md:rounded-sheet">
        <h2 id="confirm-sheet-title" className="font-serif text-xl text-ink-900">
          {title}
        </h2>
        <div className="mt-2 text-ink-700">{body}</div>
        {reasonLabel ? (
          <div className="mt-4">
            <TextAreaField
              label={reasonLabel}
              hint={t('form.reasonHint')}
              error={touched && reasonInvalid ? t('form.reasonMin') : undefined}
              value={reason}
              maxLength={300}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="mt-3 text-sm font-medium text-stamp">
            {t(errorMessageKey(error))}
          </p>
        ) : null}
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant={destructive ? 'danger' : 'primary'} onClick={submit} loading={busy}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
