import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { CustomerDetailPage } from '@/features/customers/CustomerDetailPage';
import { CustomersPage } from '@/features/customers/CustomersPage';
import { CUSTOMER_ID, makeInvoice, v1 } from '../mocks/handlers';
import { server } from '../mocks/server';
import { renderPage } from '../render';

const customer = {
  id: CUSTOMER_ID,
  name: 'Sample Customer A',
  phone: '+919876543210',
  is_active: true,
  outstanding_paise: 12_500_000,
  overdue_paise: 5_000_000,
  notes: 'Ask for Ravi',
  preferred_language: 'en',
  open_invoice_count: 1,
};

describe('CustomerDetailPage', () => {
  function serve(overrides = {}) {
    server.use(
      http.get(v1(`/customers/${CUSTOMER_ID}`), () => HttpResponse.json({ ...customer, ...overrides })),
      http.get(v1('/invoices'), ({ request }) => {
        expect(new URL(request.url).searchParams.get('customer_id')).toBe(CUSTOMER_ID);
        return HttpResponse.json({ items: [makeInvoice()], next_cursor: null });
      }),
    );
  }
  const mount = () =>
    renderPage(<CustomerDetailPage />, { route: `/customers/${CUSTOMER_ID}`, path: '/customers/:id' });

  it('shows what the customer owes, their invoices and a way to add another', async () => {
    serve();
    mount();
    expect(await screen.findByText('Ask for Ravi')).toBeInTheDocument();
    expect(screen.getByText('+91 98765 43210')).toBeInTheDocument();
    expect(screen.getByText('1 open invoice')).toBeInTheDocument();
    expect(await screen.findByText('INV/0042')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add invoice' })).toHaveAttribute('href', `/invoices/new?customer=${CUSTOMER_ID}`);
  });

  it('marks a customer inactive with a PATCH that carries only that field', async () => {
    serve();
    let body: unknown;
    server.use(
      http.patch(v1(`/customers/${CUSTOMER_ID}`), async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ ...customer, is_active: false });
      }),
    );
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Mark as inactive' }));
    await waitFor(() => expect(body).toEqual({ is_active: false }));
  });

  it('does not offer a new invoice for an inactive customer', async () => {
    serve({ is_active: false });
    mount();
    expect(await screen.findByRole('button', { name: 'Mark as active' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Add invoice' })).not.toBeInTheDocument();
  });
});

describe('CustomersPage inactive filter', () => {
  it('asks for active customers by default and for inactive ones when toggled', async () => {
    const seen: Array<string | null> = [];
    server.use(
      http.get(v1('/customers'), ({ request }) => {
        seen.push(new URL(request.url).searchParams.get('is_active'));
        return HttpResponse.json({ items: [], next_cursor: null });
      }),
    );
    renderPage(<CustomersPage />, { route: '/customers', path: '/customers' });
    await screen.findByText('No customers yet');
    await userEvent.click(screen.getByLabelText('Show only inactive customers'));
    await waitFor(() => expect(seen.at(-1)).toBe('false'));
    expect(seen[0]).toBe('true');
  });
});
