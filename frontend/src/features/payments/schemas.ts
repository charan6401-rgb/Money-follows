import { z } from 'zod';
import { isIsoDate, todayIST } from '@/lib/dates';
import { amountIssue } from '@/features/invoices/schemas';
import { rupeeStringToPaise } from '@/lib/money';
import type { CreatePaymentRequest, PaymentMethod } from '@/types/api';

export const paymentMethods: PaymentMethod[] = ['cash', 'upi', 'bank_transfer', 'cheque', 'other'];

/** The balance is checked client-side for early feedback; the server rechecks under a lock. */
export function makePaymentSchema(invoiceDate: string, outstandingPaise: number) {
  return z.object({
    amount: z.string().superRefine((value, ctx) => {
      const issue = amountIssue(value);
      if (issue) {
        ctx.addIssue({ code: 'custom', message: issue });
        return;
      }
      const paise = rupeeStringToPaise(value);
      if (paise !== null && paise > outstandingPaise) {
        ctx.addIssue({ code: 'custom', message: 'form.amountExceeds' });
      }
    }),
    paid_on: z
      .string()
      .refine(isIsoDate, 'form.dateInvalid')
      .refine((d) => !isIsoDate(d) || d <= todayIST(), 'form.dateFuture')
      .refine((d) => !isIsoDate(d) || d >= invoiceDate, 'form.dateBeforeInvoice'),
    method: z.enum(['cash', 'upi', 'bank_transfer', 'cheque', 'other']),
    reference: z.string().trim().max(60, 'form.referenceLength'),
    note: z.string().trim().max(500, 'form.noteLength'),
  });
}

export type PaymentFormValues = z.infer<ReturnType<typeof makePaymentSchema>>;

export function toPaymentRequest(values: PaymentFormValues, allowDuplicate: boolean): CreatePaymentRequest {
  return {
    amount: values.amount.trim(),
    paid_on: values.paid_on,
    method: values.method,
    reference: values.reference === '' ? null : values.reference,
    note: values.note === '' ? null : values.note,
    allow_duplicate: allowDuplicate,
  };
}
