import { z } from 'zod';
import { normalizePhone } from '@/lib/phone';
import type { CreateCustomerRequest } from '@/types/api';

/** Messages are translation keys; the form resolves them with t(). */
export const customerSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'form.customerName')
    .max(120, 'form.customerName'),
  phone: z
    .string()
    .trim()
    .refine((value) => value === '' || normalizePhone(value) !== null, 'form.phone'),
  notes: z.string().max(1000, 'form.notesLength'),
  preferred_language: z.enum(['en', 'te']),
});

export type CustomerFormValues = z.infer<typeof customerSchema>;

export function toCustomerRequest(values: CustomerFormValues): CreateCustomerRequest {
  const phone = values.phone === '' ? null : normalizePhone(values.phone);
  const notes = values.notes.trim();
  return {
    name: values.name.trim(),
    phone,
    notes: notes === '' ? null : notes,
    preferred_language: values.preferred_language,
  };
}
