/**
 * API contract types, mirroring docs/API.md. Responses carry integer paise (`*_paise`).
 * Requests carry rupee strings (`amount`), never numbers.
 */

export type Role = 'owner' | 'admin' | 'staff';
export type Language = 'en' | 'te';

// ---------------------------------------------------------------- errors

/** Stable machine-readable error codes (API.md section 2) plus two client-side codes. */
export type ApiErrorCode =
  | 'invalid_business_header'
  | 'idempotency_key_required'
  | 'unauthenticated'
  | 'token_expired'
  | 'workspace_access_denied'
  | 'forbidden_role'
  | 'resource_not_found'
  | 'duplicate_invoice_number'
  | 'duplicate_customer_phone'
  | 'possible_duplicate_payment'
  | 'invoice_not_open'
  | 'invoice_has_active_financials'
  | 'already_reversed'
  | 'pending_promise_exists'
  | 'open_dispute_exists'
  | 'already_resolved'
  | 'immutable_record'
  | 'import_already_committed'
  | 'import_expired'
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'validation_error'
  | 'invalid_amount'
  | 'overpayment_rejected'
  | 'adjustment_exceeds_outstanding'
  | 'idempotency_key_reuse'
  | 'rate_limited'
  | 'business_limit_reached'
  | 'internal_error'
  | 'service_unavailable'
  | 'busy_retry'
  // Raised by the browser client itself, never by the server:
  | 'network_error'
  | 'timeout'
  | 'no_workspace';

export interface ApiErrorDetail {
  field?: string;
  code?: string;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message?: string;
    request_id?: string;
    details?: ApiErrorDetail[];
  };
}

// ---------------------------------------------------------------- shared

export interface Page<T> {
  items: T[];
  next_cursor: string | null;
}

// ---------------------------------------------------------------- identity and workspaces

export interface Me {
  user_id: string;
  display_name: string | null;
  preferred_language: Language;
  profile_exists: boolean;
}

export interface Workspace {
  id: string;
  name: string;
  role: Role;
  default_language: Language;
}

export interface WorkspaceList {
  items: Workspace[];
}

export interface CreateWorkspaceRequest {
  name: string;
  default_language: Language;
}

// ---------------------------------------------------------------- customers

export interface CustomerListItem {
  id: string;
  name: string;
  phone: string | null;
  is_active: boolean;
  outstanding_paise: number;
  overdue_paise: number;
}

export interface Customer extends CustomerListItem {
  notes: string | null;
  preferred_language: Language;
  open_invoice_count: number;
}

export interface CustomerCreated {
  id: string;
  name: string;
  phone: string | null;
  preferred_language: Language;
  is_active: boolean;
  outstanding_paise: number;
  created_at: string;
  similar_name_exists?: boolean;
}

export interface CreateCustomerRequest {
  name: string;
  phone: string | null;
  notes: string | null;
  preferred_language: Language;
}

export interface UpdateCustomerRequest {
  name?: string;
  phone?: string | null;
  notes?: string | null;
  preferred_language?: Language;
  is_active?: boolean;
}

// ---------------------------------------------------------------- invoices

export type InvoiceStatus = 'open' | 'cancelled';
export type PaymentState = 'unpaid' | 'partial' | 'settled';

export interface Invoice {
  id: string;
  invoice_number: string;
  fy_label: string;
  customer: { id: string; name: string };
  invoice_date: string;
  due_date: string;
  total_paise: number;
  paid_paise: number;
  adjusted_paise: number;
  outstanding_paise: number;
  status: InvoiceStatus;
  payment_state: PaymentState;
  is_overdue: boolean;
  days_overdue: number;
  has_open_dispute: boolean;
  pending_promise_date: string | null;
  created_at: string;
}

export interface InvoiceDetail extends Invoice {
  notes: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
}

export interface CreateInvoiceRequest {
  customer_id: string;
  invoice_number: string;
  invoice_date: string;
  due_date: string;
  /** Rupees as a string, for example "12500.50". */
  amount: string;
  notes: string | null;
}

export interface UpdateInvoiceRequest {
  due_date?: string;
  notes?: string | null;
}

export interface ReasonRequest {
  reason: string;
}

// ---------------------------------------------------------------- payments

export type PaymentMethod = 'cash' | 'upi' | 'bank_transfer' | 'cheque' | 'other';
export type PaymentStatus = 'active' | 'reversed';

export interface Payment {
  id: string;
  amount_paise: number;
  paid_on: string;
  method: PaymentMethod;
  reference: string | null;
  status: PaymentStatus;
  reversed_at: string | null;
  reversal_reason: string | null;
}

export interface CreatePaymentRequest {
  /** Rupees as a string, for example "50000.00". */
  amount: string;
  paid_on: string;
  method: PaymentMethod;
  reference: string | null;
  note: string | null;
  allow_duplicate: boolean;
}

export interface PaymentCreated {
  id: string;
  invoice_id: string;
  amount_paise: number;
  paid_on: string;
  method: PaymentMethod;
  reference: string | null;
  status: PaymentStatus;
  invoice_outstanding_paise: number;
  created_at: string;
}

export interface PaymentReversed extends Payment {
  invoice_outstanding_paise: number;
}

// ---------------------------------------------------------------- dashboard and reports

export interface DashboardSummary {
  as_of: string;
  total_outstanding_paise: number;
  overdue_outstanding_paise: number;
  open_invoice_count: number;
  overdue_invoice_count: number;
  collected_last_30_days_paise: number;
  promises_due_today: number;
  promises_overdue: number;
  open_disputes: number;
}

export type AgingBucketKey = 'current' | '1-30' | '31-60' | '61-90' | '90+';

export interface AgingBucket {
  bucket: AgingBucketKey;
  invoice_count: number;
  outstanding_paise: number;
}

export interface AgingItem {
  invoice_id: string;
  invoice_number: string;
  customer_name: string;
  due_date: string;
  days_overdue: number;
  outstanding_paise: number;
  bucket: AgingBucketKey;
}

export interface AgingReport {
  as_of: string;
  buckets: AgingBucket[];
  items: AgingItem[];
}
