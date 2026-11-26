-- Deterministic seed for Proven. No random(): everything derives from row numbers.
CREATE TABLE accounts AS
SELECT i AS account_id,
       'Account ' || lpad(CAST(i AS VARCHAR), 3, '0') AS name,
       (['starter','growth','enterprise'])[((i * 7 + i // 5) % 3) + 1] AS plan,
       CASE WHEN i % 7 = 0 THEN 'churned' ELSE 'active' END AS status,
       (i % 6 = 0) AS is_trial,
       DATE '2025-01-01' + CAST(i * 9 AS INTEGER) AS created_at,
       (['US','CA','UK','DE'])[((i * 3 + i // 4) % 4) + 1] AS country
FROM range(1, 61) t(i);

CREATE TABLE subscriptions AS
WITH subs AS (
  SELECT a.account_id, a.plan, a.status, k0 AS k,
         CASE a.plan WHEN 'starter' THEN 49 WHEN 'growth' THEN 199 ELSE 799 END AS price,
         CASE WHEN k0 = 1 THEN a.created_at ELSE a.created_at + 90 END AS started_at,
         (a.account_id % 5 = 0) AS upgraded
  FROM accounts a, range(1, 3) t(k0)
  WHERE NOT a.is_trial AND (k0 = 1 OR a.account_id % 5 = 0)
)
SELECT row_number() OVER (ORDER BY account_id, k) AS subscription_id,
       account_id, plan,
       CAST(price * CASE WHEN k = 2 THEN 1.25 ELSE 1 END AS DECIMAL(10,2)) AS mrr,
       started_at,
       CASE WHEN k = 1 AND upgraded THEN started_at + 90
            WHEN status = 'churned' THEN started_at + 120
            ELSE NULL END AS ended_at
FROM subs;

CREATE TABLE invoices AS
SELECT row_number() OVER (ORDER BY a.account_id, k) AS invoice_id,
       a.account_id,
       a.created_at + 30 * k AS issued_at,
       CAST((CASE a.plan WHEN 'starter' THEN 49 WHEN 'growth' THEN 199 ELSE 799 END) + (a.account_id % 3) * 10 AS DECIMAL(10,2)) AS total
FROM accounts a, (SELECT CAST(k0 AS INTEGER) AS k FROM range(0, 12) t(k0)) t
WHERE NOT a.is_trial
  AND k <= 5 + (a.account_id % 6)
  AND a.created_at + 30 * k <= DATE '2026-11-20'
  AND (a.status <> 'churned' OR k <= 4);

CREATE TABLE invoice_lines AS
SELECT row_number() OVER (ORDER BY i.invoice_id, n) AS line_id,
       i.invoice_id,
       CASE WHEN n = 1 THEN 'Platform subscription' ELSE 'Usage and support' END AS description,
       CASE WHEN n = 1 THEN CAST(ROUND(i.total * 0.8, 2) AS DECIMAL(10,2))
            ELSE i.total - CAST(ROUND(i.total * 0.8, 2) AS DECIMAL(10,2)) END AS amount
FROM invoices i, range(1, 3) t(n);

CREATE TABLE payments AS
SELECT invoice_id AS payment_id,
       invoice_id,
       issued_at + 3 AS paid_at,
       total AS amount,
       CASE WHEN invoice_id % 13 = 0 THEN 'refunded'
            WHEN invoice_id % 11 = 0 THEN 'failed'
            ELSE 'succeeded' END AS status
FROM invoices;
