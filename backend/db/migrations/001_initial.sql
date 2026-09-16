CREATE TABLE assets (
 id uuid PRIMARY KEY, object_key text NOT NULL UNIQUE, sha256 text NOT NULL UNIQUE,
 mime text NOT NULL, bytes integer NOT NULL CHECK(bytes>0), width integer, height integer,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE asset_aliases (path text PRIMARY KEY, asset_id uuid NOT NULL REFERENCES assets(id));
CREATE TABLE workspace (
 id integer PRIMARY KEY CHECK(id=1), revision integer NOT NULL DEFAULT 0,
 release_title text NOT NULL DEFAULT 'Следующая редакция', changelog text NOT NULL DEFAULT '',
 changelog_stamp text NOT NULL DEFAULT '', baseline jsonb NOT NULL DEFAULT '[]',
 legacy_imported boolean NOT NULL DEFAULT false, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE cards (
 id text PRIMARY KEY, position integer NOT NULL, name text NOT NULL,
 card_type text NOT NULL CHECK(card_type IN ('правило','роль','умение','припас','мёртвый бонус','наёмник')),
 description text NOT NULL, activation_time text[] NOT NULL DEFAULT '{}', usage_frequency text NOT NULL DEFAULT '',
 usage_location text[] NOT NULL DEFAULT '{}', tags text[] NOT NULL DEFAULT '{}',
 image_asset_id uuid REFERENCES assets(id), change_kind text NOT NULL DEFAULT 'Уточнение', editorial_note text NOT NULL DEFAULT '',
 source jsonb, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cards_type_position ON cards(card_type,position);
CREATE INDEX cards_tags ON cards USING gin(tags);
CREATE TABLE import_backups (id uuid PRIMARY KEY, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE pdf_jobs (
 id uuid PRIMARY KEY, status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','ready','failed')),
 workspace_revision integer NOT NULL, snapshot jsonb NOT NULL, template_version text NOT NULL,
 report jsonb, object_key text, html_key text, error text, attempts integer NOT NULL DEFAULT 0,
 lease_until timestamptz, lease_token uuid, created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz
);
CREATE INDEX pdf_jobs_queue ON pdf_jobs(created_at) WHERE status IN ('queued','running');
CREATE TABLE releases (
 id uuid PRIMARY KEY, title text NOT NULL, workspace_revision integer NOT NULL UNIQUE,
 snapshot jsonb NOT NULL, changelog text NOT NULL, pdf_job_id uuid NOT NULL UNIQUE REFERENCES pdf_jobs(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
