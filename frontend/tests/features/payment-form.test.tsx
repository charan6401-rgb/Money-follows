import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { PaymentFormPage } from '@/features/payments/PaymentFormPage';
import { makePaymentSchema } from '@/features/payments/schemas';
import { todayIST } from '@/lib/dates';
import { INVOICE_ID, makeInvoiceDetail, v1 } from '../mocks/handlers';
import { server } from '../mocks/server';
import { renderPage } from '../render';

const created = {
  id: 'c1a2b3d4-1111-4222-8333-444455556666',
  invoice_id: INVOICE_ID,
  amount_paise: 5_000_000,
  paid_on: '2026-10-12',
  method: 'upi',
  reference: null,
  status: 'active',
  invoice_outstanding_paise: 7_500_000,
  created_at: '2026-10-13T06:10:00Z',
};

function serveInvoice(overrides = {}) {
  server.use(http.get(v1(`/invoices/${INVOICE_ID}`), () => HttpResponse.json(makeInvoiceDetail(overrides))));
}

function mount() {
  return renderPage(<PaymentFormPage />, { route: `/invoices/${INVOICE_ID}/pay`, path: '/invoices/:id/pay' });
}

async function enterAmount(value: string) {
  const field = await screen.findByLabelText(/^Amount received/);
  await userEvent.clear(field);
  await userEvent.type(field, value);
}

async function toReview(amount = '500.00') {
  await enterAmount(amount);
  await userEvent.click(screen.getByRole('button', { name: 'Review payment' }));
}

describe('PaymentFormPage', () => {
  it('checks the details, then saves with an Idempotency-Key and returns to the invoice', async () => {
    serveInvoice();
    let headers: Headers | undefined;
    let body: Record<string, unknown> = {};
    server.use(
      http.post(v1(`/invoices/${INVOICE_ID}/payments`), async ({ request }) => {
        headers = request.headers;
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(created, { status: 201 });
      }),
    );
    mount();
    await toReview('500.00');
    expect(await screen.findByText('Check before you save')).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveTextContent('₹1,24,500.00'); // 125000 - 500
    await userEvent.click(screen.getByRole('button', { name: 'Save payment' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(`/invoices/${INVOICE_ID}`));
    expect(headers?.get('Idempotency-Key')).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
    expect(body).toMatchObject({ amount: '500.00', method: 'upi', reference: null, note: null, allow_duplicate: false });
    expect(typeof body.amount).toBe('string');
  });

  it('says when a payment settles the invoice', async () => {
    serveInvoice();
    mount();
    await screen.findByLabelText(/^Amount received/);
    await userEvent.click(screen.getByRole('button', { name: 'Fill the full balance' }));
    expect(screen.getByLabelText(/^Amount received/)).toHaveValue('125000.00');
    await userEvent.click(screen.getByRole('button', { name: 'Review payment' }));
    expect(await screen.findByText('This pays the invoice in full.')).toBeInTheDocument();
  });

  it.each([
    ['', /Use digits/],
    ['abc', /Use digits/],
    ['0', 'The amount must be more than zero.'],
    ['1,000', /Use digits/],
    ['1250000.01', 'This is more than the balance left on the invoice.'],
  ])('rejects the amount "%s" without sending', async (amount, message) => {
    serveInvoice();
    let posted = false;
    server.use(http.post(v1(`/invoices/${INVOICE_ID}/payments`), () => ((posted = true), HttpResponse.json(created, { status: 201 }))));
    mount();
    if (amount) await enterAmount(amount);
    await screen.findByLabelText(/^Amount received/);
    await userEvent.click(screen.getByRole('button', { name: 'Review payment' }));
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.queryByText('Check before you save')).not.toBeInTheDocument();
    expect(posted).toBe(false);
  });

  it('rejects a date before the invoice date and a date in the future', async () => {
    serveInvoice();
    mount();
    await enterAmount('10');
    fireEvent.change(screen.getByLabelText('Date received'), { target: { value: '2026-09-30' } });
    await userEvent.click(screen.getByRole('button', { name: 'Review payment' }));
    expect(await screen.findByText('The date cannot be before the invoice date.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Date received'), { target: { value: '2999-01-01' } });
    await userEvent.click(screen.getByRole('button', { name: 'Review payment' }));
    expect(await screen.findByText('The date cannot be in the future.')).toBeInTheDocument();
  });

  it('reuses the same Idempotency-Key when the connection drops and the user retries', async () => {
    serveInvoice();
    const keys: Array<string | null> = [];
    let calls = 0;
    server.use(
      http.post(v1(`/invoices/${INVOICE_ID}/payments`), ({ request }) => {
        keys.push(request.headers.get('Idempotency-Key'));
        calls += 1;
        return calls === 1 ? HttpResponse.error() : HttpResponse.json(created, { status: 201 });
      }),
    );
    mount();
    await toReview('500');
    await userEvent.click(await screen.findByRole('button', { name: 'Save payment' }));
    expect(await screen.findByText('We could not confirm this payment')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(`/invoices/${INVOICE_ID}`));
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
  });

  it('asks before saving a likely duplicate, then sends allow_duplicate with a new key', async () => {
    serveInvoice();
    const seen: Array<{ key: string | null; allow: unknown }> = [];
    server.use(
      http.post(v1(`/invoices/${INVOICE_ID}/payments`), async ({ request }) => {
        const body = (await request.json()) as { allow_duplicate: boolean };
        seen.push({ key: request.headers.get('Idempotency-Key'), allow: body.allow_duplicate });
        return body.allow_duplicate
          ? HttpResponse.json(created, { status: 201 })
          : HttpResponse.json({ error: { code: 'possible_duplicate_payment', message: 'x', request_id: 'r' } }, { status: 409 });
      }),
    );
    mount();
    await toReview('500');
    await userEvent.click(await screen.findByRole('button', { name: 'Save payment' }));
    expect(await screen.findByText('This looks like a payment you already recorded')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save anyway' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(`/invoices/${INVOICE_ID}`));
    expect(seen.map((s) => s.allow)).toEqual([false, true]);
    expect(seen[1]?.key).not.toBe(seen[0]?.key); // a changed body is a different request
  });

  it('shows the server message when the balance changed and the payment is now too large', async () => {
    serveInvoice();
    server.use(
      http.post(v1(`/invoices/${INVOICE_ID}/payments`), () =>
        HttpResponse.json({ error: { code: 'overpayment_rejected', message: 'x', request_id: 'r' } }, { status: 422 }),
      ),
    );
    mount();
    await toReview('500');
    await userEvent.click(await screen.findByRole('button', { name: 'Save payment' }));
    expect(await screen.findByText(/This is more than the balance left on the invoice. Enter a smaller amount./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change details' })).toBeEnabled();
  });

  it('lets the user go back and change the details', async () => {
    serveInvoice();
    mount();
    await toReview('500');
    await userEvent.click(await screen.findByRole('button', { name: 'Change details' }));
    expect(await screen.findByLabelText(/^Amount received/)).toHaveValue('500');
  });

  it.each([
    ['a cancelled invoice', { status: 'cancelled' as const }],
    ['a paid-in-full invoice', { paid_paise: 12_500_000, outstanding_paise: 0, payment_state: 'settled' as const }],
  ])('does not show the form for %s', async (_name, overrides) => {
    serveInvoice(overrides);
    mount();
    expect(await screen.findByText('This invoice cannot take payments.')).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Amount received/)).not.toBeInTheDocument();
  });
});

describe('makePaymentSchema', () => {
  const schema = makePaymentSchema('2026-10-01', 10_000);
  const base = { amount: '100.00', paid_on: '2026-10-05', method: 'cash', reference: '', note: '' };
  it('accepts the exact balance and rejects one paisa more', () => {
    expect(schema.safeParse({ ...base, amount: '100.00' }).success).toBe(true);
    expect(schema.safeParse({ ...base, amount: '100.01' }).success).toBe(false);
  });
  it('accepts the invoice date and today, but not the day before or tomorrow', () => {
    expect(schema.safeParse({ ...base, paid_on: '2026-10-01' }).success).toBe(true);
    expect(schema.safeParse({ ...base, paid_on: todayIST() }).success).toBe(true);
    expect(schema.safeParse({ ...base, paid_on: '2026-09-30' }).success).toBe(false);
  });
  it('rejects an unknown method and an over-long reference', () => {
    expect(schema.safeParse({ ...base, method: 'bitcoin' }).success).toBe(false);
    expect(schema.safeParse({ ...base, reference: 'x'.repeat(61) }).success).toBe(false);
  });
});
