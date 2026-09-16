ALTER TABLE cards ADD COLUMN version integer NOT NULL DEFAULT 1;
CREATE TABLE users (
 id uuid PRIMARY KEY, telegram_id text NOT NULL UNIQUE, display_name text NOT NULL,
 username text NOT NULL DEFAULT '', role text NOT NULL DEFAULT 'player' CHECK(role IN ('player','trusted','admin')),
 disabled boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), last_login_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sessions (
 token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), csrf text NOT NULL,
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE login_attempts (
 state_hash text PRIMARY KEY, browser_hash text NOT NULL, verifier text NOT NULL, expires_at timestamptz NOT NULL
);
CREATE TABLE public_cards (id text PRIMARY KEY, position integer NOT NULL, data jsonb NOT NULL);
-- Only the accepted baseline is public; never import the current draft here.
INSERT INTO public_cards(id,position,data)
 SELECT v->>'id',n::int,v-'source'-'note'-'kind' FROM workspace, jsonb_array_elements(baseline) WITH ORDINALITY AS b(v,n);
CREATE TABLE proposals (
 id uuid PRIMARY KEY, author_id uuid NOT NULL REFERENCES users(id), card_id text,
 base jsonb, proposed jsonb NOT NULL, reason text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected','withdrawn')),
 reviewer_id uuid REFERENCES users(id), review_note text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(), reviewed_at timestamptz
);
CREATE INDEX proposals_status_created ON proposals(status,created_at DESC);
CREATE INDEX proposals_author ON proposals(author_id,created_at DESC);
CREATE TABLE audit_log (
 id bigserial PRIMARY KEY, actor_id uuid REFERENCES users(id), action text NOT NULL,
 entity_id text NOT NULL, before_data jsonb, after_data jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_entity ON audit_log(entity_id,created_at DESC);
