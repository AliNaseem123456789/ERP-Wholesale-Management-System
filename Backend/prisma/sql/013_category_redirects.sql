-- =============================================================================
-- 013: where an old category's address should send visitors once it's hidden
--      (e.g. /categories/zippo -> /brands/zippo), and a log of category tidy-ups
--      so a tidy-up can be undone (scripts/categories-tidy.js).
-- ADDITIVE ONLY: one new nullable column and one new table. Existing rows are not changed.
-- =============================================================================

ALTER TABLE categories ADD COLUMN IF NOT EXISTS redirect_to VARCHAR(500); -- a path on this site, used only when the category is hidden

CREATE TABLE IF NOT EXISTS category_tidy_runs (
  id          BIGSERIAL PRIMARY KEY,
  applied_at  TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  undone_at   TIMESTAMPTZ(6),
  summary     JSONB NOT NULL DEFAULT '{}',   -- what changed, for people
  backup      JSONB NOT NULL                 -- everything needed to put it back exactly
);
