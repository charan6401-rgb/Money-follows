/**
 * Every business-data key starts with the business id, so switching business can never show
 * another business's cached records.
 */
export const keys = {
  dashboard: (b: string) => [b, 'dashboard'] as const,
  aging: (b: string) => [b, 'aging'] as const,
  customers: (b: string, q: string, includeInactive: boolean) =>
    [b, 'customers', { q, includeInactive }] as const,
  customersAll: (b: string) => [b, 'customers'] as const,
  customer: (b: string, id: string) => [b, 'customer', id] as const,
  invoices: (b: string, filter: string, customerId: string | undefined) =>
    [b, 'invoices', { filter, customerId }] as const,
  invoicesAll: (b: string) => [b, 'invoices'] as const,
  invoice: (b: string, id: string) => [b, 'invoice', id] as const,
  payments: (b: string, invoiceId: string) => [b, 'payments', invoiceId] as const,
};
