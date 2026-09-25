CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE SCHEMA IF NOT EXISTS iam;
CREATE SCHEMA IF NOT EXISTS catalog;
CREATE SCHEMA IF NOT EXISTS workflow;
CREATE SCHEMA IF NOT EXISTS media;
CREATE SCHEMA IF NOT EXISTS private_material;
CREATE SCHEMA IF NOT EXISTS community;
CREATE SCHEMA IF NOT EXISTS comparison;
CREATE SCHEMA IF NOT EXISTS search;
CREATE SCHEMA IF NOT EXISTS taxonomy;
CREATE SCHEMA IF NOT EXISTS analytics;
CREATE SCHEMA IF NOT EXISTS ops;
CREATE SCHEMA IF NOT EXISTS audit;

COMMENT ON SCHEMA catalog IS 'Published VibeCheck catalog facts and immutable versions';
COMMENT ON SCHEMA workflow IS 'Draft, review and administrative workflow resources';
COMMENT ON SCHEMA private_material IS 'Restricted identity-verification material metadata';
COMMENT ON SCHEMA analytics IS 'Immutable analytics envelopes and versioned metric resources';
COMMENT ON SCHEMA audit IS 'Append-only security and administrative audit records';
