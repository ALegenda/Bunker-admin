-- Additive schema remains compatible with the old API during a rolling deployment.
ALTER TABLE cards ADD COLUMN card_color text NOT NULL DEFAULT '';
ALTER TABLE cards ADD COLUMN effects text[] NOT NULL DEFAULT '{}';
CREATE INDEX cards_color ON cards(card_color) WHERE card_color <> '';
CREATE INDEX cards_effects ON cards USING gin(effects);
