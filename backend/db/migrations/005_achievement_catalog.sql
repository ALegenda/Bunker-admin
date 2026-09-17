CREATE TABLE achievement_definitions (
 id uuid PRIMARY KEY,
 title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 100),
 description text NOT NULL DEFAULT '',
 target integer NOT NULL CHECK(target BETWEEN 1 AND 1000000),
 revision integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now()
);
