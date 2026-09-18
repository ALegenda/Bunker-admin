ALTER TABLE cards ADD COLUMN dangerous_personality boolean NOT NULL DEFAULT false;
ALTER TABLE cards ADD COLUMN usage_condition text NOT NULL DEFAULT '';
