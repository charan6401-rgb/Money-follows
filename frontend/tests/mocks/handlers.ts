import { http, HttpResponse } from 'msw';
import type { Invoice, InvoiceDetail, Payment, Workspace } from '../../src/types/api';

/**
 * TEST-ONLY fixtures and default handlers. They follow docs/API.md and use fictitious values.
 * Nothing in this file is imported by application code.
 */

export const API = 'http://api.test';
export const v1 = (path: string) => `${API}/api/v1${path}`;

export const BUSINESS_ID = '5f2b8a40-0c3e-4a79-9d51-0a6b0f3c1e11';
export const CUSTOMER_ID = '0b0f9d5e-6a8d-4d0c-b3a3-2c6f1d1c7a01';
export const INVOICE_ID = '9d2f4a77-7b1e-4b8a-8c52-0f0e5a3b9c10';

export function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: BUSINESS_ID,
    name: 'Sample Traders',
    role: 'owner',
    default_language: 'en',
    ...overrides,
  };
}

export function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: INVOICE_ID,
    invoice_number: 'INV/0042',
    fy_label: '2026-27',
    customer: { id: CUSTOMER_ID, name: 'Sample Customer A' },
    invoice_date: '2026-10-01',
    due_date: '2026-10-31',
    total_paise: 12_500_000,
    paid_paise: 0,
    adjusted_paise: 0,
    outstanding_paise: 12_500_000,
    status: 'open',
    payment_state: 'unpaid',
    is_overdue: false,
    days_overdue: 0,
    has_open_dispute: false,
    pending_promise_date: null,
    created_at: '2026-10-01T06:05:00Z',
    ...overrides,
  };
}

export function makeInvoiceDetail(overrides: Partial<InvoiceDetail> = {}): InvoiceDetail {
  return { ...makeInvoice(), notes: null, cancelled_at: null, cancel_reason: null, ...overrides };
}

export function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: 'c1a2b3d4-1111-4222-8333-444455556666',
    amount_paise: 5_000_000,
    paid_on: '2026-10-12',
    method: 'upi',
    reference: 'SAMPLEREF0001',
    status: 'active',
    reversed_at: null,
    reversal_reason: null,
    ...overrides,
  };
}

/** Defaults: the API is alive and every other request must be handled explicitly by the test. */
export const handlers = [
  http.get(`${API}/health/live`, () => HttpResponse.json({ status: 'ok' })),
];
