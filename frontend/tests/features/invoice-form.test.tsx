import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { invoiceSchema } from '@/features/invoices/schemas';
import { InvoiceFormPage } from '@/features/invoices/InvoiceFormPage';
import { todayIST } from '@/lib/dates';
import { CUSTOMER_ID, INVOICE_ID, makeInvoice, v1 } from '../mocks/handlers';
import { server } from '../mocks/server';
import { renderPage } from '../render';

const customerRow = {
  id: CUSTOMER_ID,
  name: 'Sample Customer A',
  phone: '+919876543210',
  is_active: true,
  outstanding_paise: 0,
  overdue_paise: 0,
};

function useCustomers() {
  server.use(
    http.get(v1('/customers'), () => HttpResponse.json({ items: [customerRow], next_cursor: null })),
    http.get(v1(`/customers/${CUSTOMER_ID}`), () =>
      HttpResponse.json({ ...customerRow, notes: null, preferred_language: 'en', open_invoice_count: 0 }),
    ),
  );
}

function mount(route = '/invoices/new') {
  return renderPage(<InvoiceFormPage />, { route, path: '/invoices/new' });
}

async function fill(label: string, value: string) {
  const field = screen.getByLabelText(new RegExp(`^${label}`));
  await userEvent.clear(field);
  await userEvent.type(field, value);
}

describe('InvoiceFormPage', () => {
  it('shows what is missing and sends nothing', async () => {
    useCustomers();
    let posted = false;
    server.use(http.post(v1('/invoices'), () => ((posted = true), HttpResponse.json({}, { status: 201 }))));
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'Save invoice' }));
    expect(await screen.findByText('Choose a customer.')).toBeInTheDocument();
    expect(screen.getByText('Enter the invoice number (up to 40 characters).')).toBeInTheDocument();
    expect(screen.getByText(/Use digits and an optional decimal point/)).toBeInTheDocument();
    expect(posted).toBe(false);
  });

  it('creates an invoice with the amount as a rupee string and opens it', async () => {
    useCustomers();
    let body: Record<string, unknown> = {};
    server.use(
      http.post(v1('/invoices'), async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeInvoice(), { status: 201 });
      }),
    );
    mount();
    await userEvent.click(await screen.findByRole('button', { name: /Sample Customer A/ }));
    expect(screen.getByText('Sample Customer A')).toBeInTheDocument();
    await fill('Invoice number', '  INV/0042 ');
    await fill('Invoice amount', '12500.50');
    await userEvent.click(screen.getByRole('button', { name: 'Save invoice' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(`/invoices/${INVOICE_ID}`));
    expect(body).toMatchObject({
      customer_id: CUSTOMER_ID,
      invoice_number: 'INV/0042',
      amount: '12500.50',
      notes: null,
    });
    expect(typeof body.amount).toBe('string');
    expect(Object.keys(body).sort()).toEqual(['amount', 'customer_id', 'due_date', 'invoice_date', 'invoice_number', 'notes']);
  });

  it('preselects the customer from the address', async () => {
    useCustomers();
    mount(`/invoices/new?customer=${CUSTOMER_ID}`);
    expect(await screen.findByText('Sample Customer A')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change customer' })).toBeInTheDocument();
  });

  it('ignores a customer id in the address that is not a UUID', async () => {
    useCustomers();
    mount('/invoices/new?customer=../../etc');
    expect(await screen.findByRole('button', { name: /Sample Customer A/ })).toBeInTheDocument();
  });

  it.each([
    ['12,500', /Use digits/],
    ['1e5', /Use digits/],
    ['-5', /Use digits/],
    ['10.123', /Use digits/],
    ['0', 'The amount must be more than zero.'],
    ['0.00', 'The amount must be more than zero.'],
    ['1000000000000', 'That amount is too large.'],
  ])('rejects the amount %s before sending', async (amount, message) => {
    useCustomers();
    mount(`/invoices/new?customer=${CUSTOMER_ID}`);
    await screen.findByText('Sample Customer A');
    await fill('Invoice number', 'A1');
    await fill('Invoice amount', amount);
    await userEvent.click(screen.getByRole('button', { name: 'Save invoice' }));
    expect(await screen.findByText(message)).toBeInTheDocument();
  });

  it('rejects a due date before the invoice date', async () => {
    useCustomers();
    mount(`/invoices/new?customer=${CUSTOMER_ID}`);
    await screen.findByText('Sample Customer A');
    await fill('Invoice number', 'A1');
    await fill('Invoice amount', '10');
    fireEvent.change(screen.getByLabelText('Invoice date'), { target: { value: '2026-04-10' } });
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2026-04-01' } });
    await userEvent.click(screen.getByRole('button', { name: 'Save invoice' }));
    expect(await screen.findByText('The due date cannot be before the invoice date.')).toBeInTheDocument();
  });

  it('shows a duplicate invoice number next to the number field', async () => {
    useCustomers();
    server.use(
      http.post(v1('/invoices'), () =>
        HttpResponse.json({ error: { code: 'duplicate_invoice_number', message: 'x', request_id: 'r' } }, { status: 409 }),
      ),
    );
    mount(`/invoices/new?customer=${CUSTOMER_ID}`);
    await screen.findByText('Sample Customer A');
    await fill('Invoice number', 'INV/1');
    await fill('Invoice amount', '10');
    await userEvent.click(screen.getByRole('button', { name: 'Save invoice' }));
    const message = await screen.findByText('This invoice number is already used in this financial year.');
    expect(message).toHaveAttribute('role', 'alert');
    expect(screen.getByLabelText(/^Invoice number/)).toHaveAttribute('aria-invalid', 'true');
  });

  it('shows a general error when saving fails for another reason', async () => {
    useCustomers();
    server.use(
      http.post(v1('/invoices'), () =>
        HttpResponse.json({ error: { code: 'service_unavailable', message: 'x', request_id: 'r' } }, { status: 503 }),
      ),
    );
    mount(`/invoices/new?customer=${CUSTOMER_ID}`);
    await screen.findByText('Sample Customer A');
    await fill('Invoice number', 'INV/2');
    await fill('Invoice amount', '10');
    await userEvent.click(screen.getByRole('button', { name: 'Save invoice' }));
    expect(await screen.findByText('The service is temporarily unavailable. Try again in a moment.')).toBeInTheDocument();
  });
});

describe('invoiceSchema', () => {
  const base = {
    customer_id: CUSTOMER_ID,
    invoice_number: 'A',
    invoice_date: '2026-04-01',
    due_date: '2026-05-01',
    amount: '10',
    notes: '',
  };
  it('accepts a valid invoice', () => {
    expect(invoiceSchema.safeParse(base).success).toBe(true);
  });
  it('rejects a future invoice date and a date before 2000', () => {
    const tomorrow = new Date(Date.parse(`${todayIST()}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    expect(invoiceSchema.safeParse({ ...base, invoice_date: tomorrow, due_date: tomorrow }).success).toBe(false);
    expect(invoiceSchema.safeParse({ ...base, invoice_date: '1999-12-31', due_date: '2000-01-31' }).success).toBe(false);
  });
  it('rejects impossible calendar dates', () => {
    expect(invoiceSchema.safeParse({ ...base, invoice_date: '2026-02-30' }).success).toBe(false);
  });
  it('rejects a 41 character number and a 1001 character note', () => {
    expect(invoiceSchema.safeParse({ ...base, invoice_number: 'x'.repeat(41) }).success).toBe(false);
    expect(invoiceSchema.safeParse({ ...base, notes: 'x'.repeat(1001) }).success).toBe(false);
  });
});
