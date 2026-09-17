ALTER TABLE users ADD COLUMN custom_display_name boolean NOT NULL DEFAULT false;
CREATE TABLE player_profiles (
 user_id uuid PRIMARY KEY REFERENCES users(id),
 level integer NOT NULL DEFAULT 1 CHECK(level BETWEEN 1 AND 1000000),
 balance integer NOT NULL DEFAULT 0 CHECK(balance >= 0),
 achievements jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(achievements) = 'array'),
 revision integer NOT NULL DEFAULT 0
);
CREATE TABLE card_tips (
 id uuid PRIMARY KEY,
 card_id text NOT NULL,
 author_id uuid NOT NULL REFERENCES users(id),
 body text NOT NULL CHECK(length(btrim(body)) BETWEEN 1 AND 3000),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','published','rejected')),
 reviewer_id uuid REFERENCES users(id),
 review_note text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(),
 reviewed_at timestamptz
);
-- No FK to public_cards: publication replaces the catalogue in a transaction.
CREATE INDEX card_tips_card ON card_tips(card_id,created_at DESC);
CREATE INDEX card_tips_status ON card_tips(status,created_at DESC);
