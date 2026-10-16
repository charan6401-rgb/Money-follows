import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { NotFoundPage } from '@/app/NotFoundPage';
import { RequireAuth, RequireWorkspace } from '@/app/guards';
import { NavLayout } from '@/components/layout/NavLayout';
import { SignInPage } from '@/features/auth/SignInPage';
import { CustomerFormPage } from '@/features/customers/CustomerFormPage';
import { CustomersPage } from '@/features/customers/CustomersPage';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { WorkspaceCreatePage, WorkspacePickerPage } from '@/features/workspaces/WorkspacePages';

/**
 * Route guards here are UX only. Every API call is verified server-side (SECURITY.md).
 *
 * Only pages that exist are routed. Still to be added as they are built: customer detail,
 * invoices (list, new, detail), the payment form, and More. Until then those paths show
 * the not-found page rather than a placeholder screen.
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
              <Route path="*" element={<NotFoundPage />} />
            </Route>
            <Route path="/customers/new" element={<CustomerFormPage />} />
            <Route path="/customers/:id/edit" element={<CustomerFormPage />} />
          </Route>
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  );
}
