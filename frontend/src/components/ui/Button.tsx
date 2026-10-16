import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'danger' | 'quiet';

const base =
  'inline-flex min-h-touch items-center justify-center gap-2 rounded-control px-5 text-base font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50';

const variants: Record<Variant, string> = {
  primary: 'bg-ink-900 text-white hover:bg-ink-700 active:bg-ink-700',
  secondary: 'border border-cement-300 bg-white text-ink-900 hover:bg-cement-100',
  danger: 'bg-stamp text-white hover:bg-[#9A1D14]',
  quiet: 'px-3 text-ink-700 hover:bg-cement-200',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  loading?: boolean;
  block?: boolean;
}

export function Button({
  variant = 'primary',
  loading = false,
  block = false,
  className,
  disabled,
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(base, variants[variant], block && 'w-full', className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {children}
    </button>
  );
}

interface LinkButtonProps extends LinkProps {
  variant?: Variant;
  block?: boolean;
  children: ReactNode;
}

export function LinkButton({
  variant = 'primary',
  block = false,
  className,
  children,
  ...rest
}: LinkButtonProps) {
  return (
    <Link className={cn(base, variants[variant], block && 'w-full', className)} {...rest}>
      {children}
    </Link>
  );
}
