"""The ONE authoritative definition of an invoice balance (AGENTS.md section 5, DECISIONS D-2/D-10).

outstanding = total - active payments - active adjustments. It is derived at read time and never
stored. Customers, invoices and reports all build on BALANCE_FROM / BALANCE_COLUMNS so the maths
exists in exactly one place. Every fragment here is a constant: no user input is ever interpolated.
"""

TODAY_IST = "(now() AT TIME ZONE 'Asia/Kolkata')::date"

BALANCE_FROM = """
mf.invoices i
LEFT JOIN LATERAL (
  SELECT SUM(amount_paise) AS paid FROM mf.payments
  WHERE business_id = i.business_id AND invoice_id = i.id AND status = 'active') p ON true
LEFT JOIN LATERAL (
  SELECT SUM(amount_paise) AS adj FROM mf.invoice_adjustments
  WHERE business_id = i.business_id AND invoice_id = i.id AND status = 'active') a ON true
"""

# paid_paise, adjusted_paise, outstanding_paise are bigint (SUM of bigint is numeric, so it is cast).
BALANCE_COLUMNS = """
i.id, i.invoice_number, i.fy_start_year, i.customer_id, i.invoice_date, i.due_date, i.total_paise,
i.status, i.created_at, i.notes, i.cancelled_at, i.cancel_reason,
COALESCE(p.paid, 0)::bigint AS paid_paise,
COALESCE(a.adj, 0)::bigint AS adjusted_paise,
(i.total_paise - COALESCE(p.paid, 0) - COALESCE(a.adj, 0))::bigint AS outstanding_paise
"""

# Display state, defined once. 'settled' means nothing left to collect.
PAYMENT_STATE = """
CASE
  WHEN (i.total_paise - COALESCE(p.paid, 0) - COALESCE(a.adj, 0)) <= 0 THEN 'settled'
  WHEN COALESCE(p.paid, 0) + COALESCE(a.adj, 0) > 0 THEN 'partial'
  ELSE 'unpaid'
END
"""

IS_OVERDUE = f"""
(i.status = 'open'
 AND (i.total_paise - COALESCE(p.paid, 0) - COALESCE(a.adj, 0)) > 0
 AND i.due_date < {TODAY_IST})
"""

INVOICE_SELECT = f"""
SELECT {BALANCE_COLUMNS},
  {PAYMENT_STATE} AS payment_state,
  {IS_OVERDUE} AS is_overdue,
  CASE WHEN {IS_OVERDUE} THEN ({TODAY_IST} - i.due_date) ELSE 0 END AS days_overdue,
  EXISTS (SELECT 1 FROM mf.disputes d WHERE d.business_id = i.business_id
          AND d.invoice_id = i.id AND d.status = 'open') AS has_open_dispute,
  (SELECT pp.promised_date FROM mf.payment_promises pp WHERE pp.business_id = i.business_id
   AND pp.invoice_id = i.id AND pp.status = 'pending') AS pending_promise_date,
  c.name AS customer_name
FROM {BALANCE_FROM}
JOIN mf.customers c ON c.business_id = i.business_id AND c.id = i.customer_id
"""
