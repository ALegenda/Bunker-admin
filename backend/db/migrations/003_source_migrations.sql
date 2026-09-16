CREATE TABLE source_migrations (
 id text PRIMARY KEY,
 source_sha256 text NOT NULL,
 manifest_sha256 text NOT NULL,
 backup_id uuid NOT NULL REFERENCES import_backups(id),
 report jsonb NOT NULL,
 applied_at timestamptz NOT NULL DEFAULT now()
);
