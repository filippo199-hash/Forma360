-- Add jurisdiction column to compliance_frameworks.
-- Empty string / NULL means no specific jurisdiction (company-wide / global).
-- Populated value indicates the law / country / region this framework satisfies
-- (e.g. "European Union", "United Kingdom", "California", "Australia").
ALTER TABLE "compliance_frameworks"
  ADD COLUMN "jurisdiction" varchar(200);
