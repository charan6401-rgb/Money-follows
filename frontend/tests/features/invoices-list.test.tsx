import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { InvoicesPage } from '@/features/invoices/InvoicesPage';
import { makeInvoice, v1 } from '../mocks/handlers';
import { server } from '../mocks/server';
import { renderPage } from '../render';

const open = (n: number) =>
  makeInvoice({ id: `00000000-0000-4000-8000-00000000000${n}`, invoice_number: `INV/000${n}` });

function mount(route = '/invoices') {
  return renderPage(<InvoicesPage />, { route, path: '/invoices' });
}

describe('InvoicesPage', () => {
  it('lists invoices with their status and the amount still owed', async () => {
    server.use(
      http.get(v1('/invoices'), () =>
        HttpResponse.json({
          items: [
            open(1),
            makeInvoice({
              ...open(2),
              is_overdue: true,
              days_overdue: 12,
              outstanding_paise: 5_000_000,
              total_paise: 12_500_000,
              paid_paise: 7_500_000,
              payment_state: 'partial',
            }),
          ],
          next_cursor: null,
        }),
      ),
    );
    mount();
    expect((await screen.findAllByText('INV/0001')).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/12 days overdue/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('₹50,000').length).toBeGreaterThan(0);
  });

  it('sends the chosen filter to the API and keeps it in the address', async () => {
    const seen: string[] = [];
    server.use(
      http.get(v1('/invoices'), ({ request }) => {
        seen.push(new URL(request.url).search);
        return HttpResponse.json({ items: [], next_cursor: null });
      }),
    );
    mount();
    await screen.findByText('No invoices yet');
    await userEvent.click(screen.getByRole('button', { name: 'Overdue' }));
    expect(await screen.findByText('No invoices match this filter.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Overdue' })).toHaveAttribute('aria-pressed', 'true');
    expect(seen[0]).not.toContain('overdue');
    expect(seen.at(-1)).toContain('overdue=true');

    await userEvent.click(screen.getByRole('button', { name: 'Cancelled' }));
    await waitFor(() => expect(seen.at(-1)).toContain('status=cancelled'));
    await userEvent.click(screen.getByRole('button', { name: 'Partly paid' }));
    await waitFor(() => expect(seen.at(-1)).toContain('payment_state=partial'));
  });

  it('starts on the filter named in the address', async () => {
    let search = '';
    server.use(
      http.get(v1('/invoices'), ({ request }) => {
        search = new URL(request.url).search;
        return HttpResponse.json({ items: [], next_cursor: null });
      }),
    );
    mount('/invoices?filter=settled');
    await screen.findByText('No invoices match this filter.');
    expect(search).toContain('payment_state=settled');
    expect(screen.getByRole('button', { name: 'Paid in full' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('ignores an unknown filter in the address', async () => {
    server.use(http.get(v1('/invoices'), () => HttpResponse.json({ items: [], next_cursor: null })));
    mount('/invoices?filter=<script>');
    await screen.findByText('No invoices yet');
    expect(screen.getByRole('button', { name: 'Open' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows an empty state that points at adding an invoice', async () => {
    server.use(http.get(v1('/invoices'), () => HttpResponse.json({ items: [], next_cursor: null })));
    mount();
    expect(await screen.findByText('No invoices yet')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'New invoice' }).length).toBeGreaterThan(0);
  });

  it('shows a translated error with a reference and retries', async () => {
    let calls = 0;
    server.use(
      http.get(v1('/invoices'), () => {
        calls += 1;
        return calls === 1
          ? HttpResponse.json({ error: { code: 'forbidden_role', message: 'raw server text', request_id: 'req-77' } }, { status: 403 })
          : HttpResponse.json({ items: [open(3)], next_cursor: null });
      }),
    );
    mount();
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('We could not load invoices.')).toBeInTheDocument();
    expect(within(alert).getByText('Your role cannot do this. Ask the business owner.')).toBeInTheDocument();
    expect(within(alert).queryByText('raw server text')).not.toBeInTheDocument();
    expect(within(alert).getByText(/req-77/)).toBeInTheDocument();
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect((await screen.findAllByText('INV/0003')).length).toBeGreaterThan(0);
  });

  it('loads the next page with the cursor from the API', async () => {
    const cursors: Array<string | null> = [];
    server.use(
      http.get(v1('/invoices'), ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('cursor');
        cursors.push(cursor);
        return cursor
          ? HttpResponse.json({ items: [open(2)], next_cursor: null })
          : HttpResponse.json({ items: [open(1)], next_cursor: 'abc123' });
      }),
    );
    mount();
    await screen.findAllByText('INV/0001');
    await userEvent.click(screen.getByRole('button', { name: 'Show more' }));
    await screen.findAllByText('INV/0002');
    expect(cursors).toEqual([null, 'abc123']);
    expect(screen.getAllByText('INV/0001').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
  });
});
