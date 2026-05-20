-- 011_projects_body.sql
-- Adds a free-form markdown body to projects for per-project documents, links,
-- notes, and scraped artifacts. Rendered as additional blocks on the project
-- detail page (SectionHeader / P / UL / link-aware renderRich).

alter table projects add column if not exists body text;
