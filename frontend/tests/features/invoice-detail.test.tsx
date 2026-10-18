import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { InvoiceDetailPage } from '@/features/invoices/InvoiceDetailPage';
import type { Role } from '@/types/api';
import { INVOICE_ID, makeInvoiceDetail, makePayment, v1 } from '../mocks/handlers';
import { server } from '../mocks/server';
import { renderPage } from '../render';

/** The sheet that is currently open (the page mounts one hidden <dialog> per action). */
async function openDialog(): Promise<HTMLElement> {
  return waitFor(() => {
    const el = document.querySelector<HTMLElement>('dialog[open]');
    if (!el) throw new Error('no open dialog');
    return el;
  });
}

const PAYMENT_ID = 'c1a2b3d4-1111-4222-8333-444455556666';

function serve(invoice = makeInvoiceDetail(), payments = [makePayment()]) {
  server.use(
    http.get(v1(`/invoices/${INVOICE_ID}`), () => HttpResponse.json(invoice)),
    http.get(v1(`/invoices/${INVOICE_ID}/payments`), () => HttpResponse.json({ items: payments, next_cursor: null })),
  );
}

function mount(role: Role = 'owner') {
  return renderPage(<InvoiceDetailPage />, { route: `/invoices/${INVOICE_ID}`, path: '/invoices/:id', role });
}

describe('InvoiceDetailPage', () => {
  it('shows the balance, the dates, the financial year and the payment history', async () => {
    serve(
      makeInvoiceDetail({ paid_paise: 5_000_000, outstanding_paise: 7_500_000, payment_state: 'partial', notes: 'Site: Warangal' }),
    );
    mount();
    expect(await screen.findByText('INV/0042')).toBeInTheDocument();
    expect(screen.getAllByText('₹75,000').length).toBeGreaterThan(0);
    expect(screen.getByText('Financial year 2026-27')).toBeInTheDocument();
    expect(screen.getByText('Site: Warangal')).toBeInTheDocument();
    expect(screen.getByText('01-10-2026')).toBeInTheDocument();
    expect(await screen.findByText(/12-10-2026 · UPI/)).toBeInTheDocument();
    expect(screen.getByText('SAMPLEREF0001')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Record payment' })).toHaveAttribute('href', `/invoices/${INVOICE_ID}/pay`);
  });

  it('shows how late an overdue invoice is', async () => {
    serve(makeInvoiceDetail({ is_overdue: true, days_overdue: 9 }), []);
    mount();
    expect(await screen.findByText(/9 days overdue/)).toBeInTheDocument();
    expect(await screen.findByText('No payments recorded yet.')).toBeInTheDocument();
  });

  it('does not offer payment on a paid-in-full invoice', async () => {
    serve(makeInvoiceDetail({ paid_paise: 12_500_000, outstanding_paise: 0, payment_state: 'settled' }));
    mount();
    expect(await screen.findByText('This invoice is paid in full.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Record payment' })).not.toBeInTheDocument();
  });

  it('shows a cancelled invoice as cancelled with its reason and no actions', async () => {
    serve(
      makeInvoiceDetail({ status: 'cancelled', cancelled_at: '2026-10-05T06:00:00Z', cancel_reason: 'Entered twice' }),
      [],
    );
    mount();
    expect(await screen.findByText(/Cancelled 05-10-2026. Reason: Entered twice/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Record payment' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel invoice' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Edit details' })).not.toBeInTheDocument();
  });

  it('shows a reversed payment as reversed and keeps it on the list', async () => {
    serve(makeInvoiceDetail(), [
      makePayment({ status: 'reversed', reversed_at: '2026-10-13T06:00:00Z', reversal_reason: 'Cheque bounced' }),
    ]);
    mount();
    expect(await screen.findByText(/Reversed. Reversed 13-10-2026. Reason: Cheque bounced/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reverse' })).not.toBeInTheDocument();
  });

  it.each<Role>(['owner', 'admin'])('lets a %s reverse a payment with a reason', async (role) => {
    serve();
    let body: unknown;
    server.use(
      http.post(v1(`/payments/${PAYMENT_ID}/reverse`), async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ ...makePayment({ status: 'reversed' }), invoice_outstanding_paise: 12_500_000 });
      }),
    );
    mount(role);
    await userEvent.click(await screen.findByRole('button', { name: 'Reverse' }));
    const dialog = await openDialog();
    expect(within(dialog).getByText(/The ₹50,000.00 payment stays on record as reversed/)).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText(/Why is it being reversed/), 'Cheque bounced');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reverse payment' }));
    await waitFor(() => expect(body).toEqual({ reason: 'Cheque bounced' }));
  });

  it('does not send the reversal until a reason is given', async () => {
    serve();
    let called = false;
    server.use(http.post(v1(`/payments/${PAYMENT_ID}/reverse`), () => ((called = true), HttpResponse.json({}))));
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Reverse' }));
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reverse payment' }));
    expect(await within(dialog).findByText('Give a reason of at least 3 characters.')).toBeInTheDocument();
    expect(called).toBe(false);
  });

  it('hides reverse and cancel from staff (the server enforces this too)', async () => {
    serve();
    mount('staff');
    await screen.findByText(/12-10-2026 · UPI/);
    expect(screen.queryByRole('button', { name: 'Reverse' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel invoice' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Edit details' })).toBeInTheDocument();
  });

  it('cancels an invoice with a reason', async () => {
    serve(makeInvoiceDetail(), []);
    let body: unknown;
    server.use(
      http.post(v1(`/invoices/${INVOICE_ID}/cancel`), async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(makeInvoiceDetail({ status: 'cancelled' }));
      }),
    );
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel invoice' }));
    const dialog = await openDialog();
    await userEvent.type(within(dialog).getByLabelText(/Why is it being cancelled/), 'Entered twice');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel invoice' }));
    await waitFor(() => expect(body).toEqual({ reason: 'Entered twice' }));
  });

  it('explains why an invoice with payments cannot be cancelled', async () => {
    serve();
    server.use(
      http.post(v1(`/invoices/${INVOICE_ID}/cancel`), () =>
        HttpResponse.json({ error: { code: 'invoice_has_active_financials', message: 'x', request_id: 'r' } }, { status: 409 }),
      ),
    );
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel invoice' }));
    const dialog = await openDialog();
    await userEvent.type(within(dialog).getByLabelText(/Why is it being cancelled/), 'Wrong customer');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel invoice' }));
    expect(await within(dialog).findByText('Reverse the payments on this invoice before cancelling it.')).toBeInTheDocument();
  });

  it('shows a not-found message for an invoice in another business', async () => {
    server.use(
      http.get(v1(`/invoices/${INVOICE_ID}`), () =>
        HttpResponse.json({ error: { code: 'resource_not_found', message: 'x', request_id: 'r' } }, { status: 404 }),
      ),
      http.get(v1(`/invoices/${INVOICE_ID}/payments`), () =>
        HttpResponse.json({ error: { code: 'resource_not_found', message: 'x', request_id: 'r' } }, { status: 404 }),
      ),
    );
    mount();
    expect(await screen.findByText('We could not find this record. It may have been removed.')).toBeInTheDocument();
  });
});
