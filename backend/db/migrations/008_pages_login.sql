ALTER TABLE login_attempts ADD COLUMN pages_challenge text;

CREATE TABLE pages_login_codes (
  code_hash text PRIMARY KEY,
  challenge text NOT NULL,
  session_token text NOT NULL,
  expires_at timestamptz NOT NULL
);
