import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { cn } from '@/lib/cn';

interface FieldShellProps {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  optionalLabel?: string | undefined;
  children: (ids: { id: string; describedBy: string | undefined }) => ReactNode;
}

function FieldShell({ label, hint, error, optionalLabel, children }: FieldShellProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-semibold text-ink-700">
        {label}
        {optionalLabel ? (
          <span className="ml-1 font-normal text-ink-500">({optionalLabel})</span>
        ) : null}
      </label>
      {children({ id, describedBy })}
      {hint && !error ? (
        <p id={hintId} className="mt-1 text-sm text-ink-500">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="mt-1 text-sm font-medium text-stamp">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const control =
  'block min-h-touch w-full rounded-control border bg-white px-3 py-2 text-ink placeholder:text-ink-500/70 disabled:bg-cement-100';

function borderFor(error: string | undefined): string {
  return error ? 'border-stamp' : 'border-cement-300';
}

interface BaseProps {
  label: string;
  hint?: string;
  error?: string | undefined;
  optionalLabel?: string;
}

export const TextField = forwardRef<
  HTMLInputElement,
  BaseProps & Omit<InputHTMLAttributes<HTMLInputElement>, 'id'>
>(function TextField({ label, hint, error, optionalLabel, className, ...rest }, ref) {
  return (
    <FieldShell label={label} hint={hint} error={error} optionalLabel={optionalLabel}>
      {({ id, describedBy }) => (
        <input
          ref={ref}
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(control, borderFor(error), className)}
          {...rest}
        />
      )}
    </FieldShell>
  );
});

export const TextAreaField = forwardRef<
  HTMLTextAreaElement,
  BaseProps & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'>
>(function TextAreaField({ label, hint, error, optionalLabel, className, ...rest }, ref) {
  return (
    <FieldShell label={label} hint={hint} error={error} optionalLabel={optionalLabel}>
      {({ id, describedBy }) => (
        <textarea
          ref={ref}
          id={id}
          rows={3}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(control, borderFor(error), className)}
          {...rest}
        />
      )}
    </FieldShell>
  );
});

export const SelectField = forwardRef<
  HTMLSelectElement,
  BaseProps & Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'>
>(function SelectField({ label, hint, error, optionalLabel, className, children, ...rest }, ref) {
  return (
    <FieldShell label={label} hint={hint} error={error} optionalLabel={optionalLabel}>
      {({ id, describedBy }) => (
        <select
          ref={ref}
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(control, borderFor(error), className)}
          {...rest}
        >
          {children}
        </select>
      )}
    </FieldShell>
  );
});
