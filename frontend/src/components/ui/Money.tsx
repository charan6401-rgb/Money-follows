import { splitPaise } from '@/lib/money';
import { cn } from '@/lib/cn';

interface MoneyProps {
  paise: number;
  className?: string;
  /** Show the rupee sign. Default true. */
  symbol?: boolean;
}

/**
 * An amount in rupees from integer paise: serif lining numerals, Indian digit grouping,
 * quieter paise. The text content is the full amount so screen readers read it plainly.
 */
export function Money({ paise, className, symbol = true }: MoneyProps) {
  const parts = splitPaise(paise);
  return (
    <span className={cn('num whitespace-nowrap', className)}>
      {parts.negative ? '-' : ''}
      {symbol ? '₹' : ''}
      {parts.rupees}
      <span className="num-paise">.{parts.paise}</span>
    </span>
  );
}
