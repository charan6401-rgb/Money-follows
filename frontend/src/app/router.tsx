import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { NotFoundPage } from '@/app/NotFoundPage';
import { RequireAuth, RequireWorkspace } from '@/app/guards';
import { NavLayout } from '@/components/layout/NavLayout';
import { MorePage } from '@/features/account/MorePage';
import { SignInPage } from '@/features/auth/SignInPage';
import { CustomerDetailPage } from '@/features/customers/CustomerDetailPage';
import { CustomerFormPage } from '@/features/customers/CustomerFormPage';
import { CustomersPage } from '@/features/customers/CustomersPage';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { InvoiceDetailPage } from '@/features/invoices/InvoiceDetailPage';
import { InvoiceEditPage } from '@/features/invoices/InvoiceEditPage';
import { InvoiceFormPage } from '@/features/invoices/InvoiceFormPage';
import { InvoicesPage } from '@/features/invoices/InvoicesPage';
import { PaymentFormPage } from '@/features/payments/PaymentFormPage';
import { WorkspaceCreatePage, WorkspacePickerPage } from '@/features/workspaces/WorkspacePages';

/**
 * Route guards here are UX only. Every API call is verified server-side (SECURITY.md).
 *
 * Only pages that exist are routed; any other path shows the not-found page. Not built yet
 * (backend S6-S8): adjustments, follow-ups, promises, disputes, reminder messages, CSV import.
 */
export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/sign-in" element={<SignInPage />} />

        <Route element={<RequireAuth />}>
          <Route path="/workspace" element={<WorkspacePickerPage />} />
          <Route path="/workspace/new" element={<WorkspaceCreatePage />} />

          <Route element={<RequireWorkspace />}>
            <Route element={<NavLayout />}>
              <Route index element={<DashboardPage />} />
              <Route path="/customers" element={<CustomersPage />} />
              <Route path="/invoices" element={<InvoicesPage />} />
              <Route path="/more" element={<MorePage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
            <Route path="/customers/new" element={<CustomerFormPage />} />
            <Route path="/customers/:id" element={<CustomerDetailPage />} />
            <Route path="/invoices/new" element={<InvoiceFormPage />} />
            <Route path="/invoices/:id" element={<InvoiceDetailPage />} />
            <Route path="/invoices/:id/edit" element={<InvoiceEditPage />} />
            <Route path="/invoices/:id/pay" element={<PaymentFormPage />} />
            <Route path="/customers/:id/edit" element={<CustomerFormPage />} />
          </Route>
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  );
}
