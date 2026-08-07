-- TR-B10 (training round-2 review): remove `training.view` from the seeded
-- Standard permission set.
--
-- The key gates three org-wide views — the gap list, the matrix and the
-- compliance roll-up — every one of which names individuals and their
-- competence shortfalls. Granting it to every employee by default means
-- "anyone can list any colleague's expired tickets by name", which is not
-- a defensible default for competence data under data minimisation.
--
-- A standard user keeps full access to their OWN record: `/training/me`
-- and the My work queue are scoped to the caller and need no key.
--
-- Idempotent, and deliberately scoped to the SYSTEM Standard set only —
-- a tenant that has deliberately granted the key to a custom set keeps it.
UPDATE "permission_sets"
SET "permissions" = "permissions" - 'training.view'
WHERE "is_system" = true
  AND "name" = 'Standard'
  AND "permissions" @> '["training.view"]'::jsonb;
