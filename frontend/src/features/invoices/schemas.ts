import { z } from 'zod';
import { isIsoDate, MIN_INVOICE_DATE, todayIST } from '@/lib/dates';
import { isValidRupeeString, rupeeStringToPaise } from '@/lib/money';
import type { CreateInvoiceRequest } from '@/types/api';

/** Messages are translation keys; forms resolve them with t(). The server re-checks every rule. */

export function amountIssue(value: string): 'form.amountFormat' | 'form.amountTooLarge' | 'form.amountPositive' | null {
  const text = value.trim();
  if (!isValidRupeeString(text)) {
    return /^[0-9]{13,}(\.[0-9]{1,2})?$/.test(text) ? 'form.amountTooLarge' : 'form.amountFormat';
  }
  const paise = rupeeStringToPaise(text);
  if (paise === null) return 'form.amountTooLarge';
  return paise <= 0 ? 'form.amountPositive' : null;
}

const amountField = z.string().superRefine((value, ctx) => {
  const issue = amountIssue(value);
  if (issue) ctx.addIssue({ code: 'custom', message: issue });
});

export const invoiceSchema = z
  .object({
    customer_id: z.string().uuid('form.chooseCustomer'),
    invoice_number: z.string().trim().min(1, 'form.invoiceNumber').max(40, 'form.invoiceNumber'),
    invoice_date: z.string().refine(isIsoDate, 'form.dateInvalid'),
    due_date: z.string().refine(isIsoDate, 'form.dateInvalid'),
    amount: amountField,
    notes: z.string().max(1000, 'form.notesLength'),
  })
  .superRefine((v, ctx) => {
    if (isIsoDate(v.invoice_date)) {
      if (v.invoice_date > todayIST()) {
        ctx.addIssue({ code: 'custom', path: ['invoice_date'], message: 'form.dateFuture' });
      } else if (v.invoice_date < MIN_INVOICE_DATE) {
        ctx.addIssue({ code: 'custom', path: ['invoice_date'], message: 'form.dateTooOld' });
      }
      if (isIsoDate(v.due_date) && v.due_date < v.invoice_date) {
        ctx.addIssue({ code: 'custom', path: ['due_date'], message: 'form.dueBeforeInvoice' });
      }
    }
  });

export type InvoiceFormValues = z.infer<typeof invoiceSchema>;

export function toInvoiceRequest(values: InvoiceFormValues): CreateInvoiceRequest {
  const notes = values.notes.trim();
  return {
    customer_id: values.customer_id,
    invoice_number: values.invoice_number.trim(),
    invoice_date: values.invoice_date,
    due_date: values.due_date,
    amount: values.amount.trim(),
    notes: notes === '' ? null : notes,
  };
}

/** Editable fields only: due date and notes (API.md 5.4). */
export function makeInvoiceEditSchema(invoiceDate: string) {
  return z.object({
    due_date: z
      .string()
      .refine(isIsoDate, 'form.dateInvalid')
      .refine((d) => !isIsoDate(d) || d >= invoiceDate, 'form.dueBeforeInvoice'),
    notes: z.string().max(1000, 'form.notesLength'),
  });
}
export type InvoiceEditValues = z.infer<ReturnType<typeof makeInvoiceEditSchema>>;
