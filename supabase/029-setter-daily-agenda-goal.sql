-- Daily agenda minimum (Mon-Fri), separate from the weekly/monthly ones
-- already in setter_goals — a setter is now expected to book 7 calls per
-- weekday specifically, not just hit a weekly total however it's spread out.
ALTER TABLE setter_goals ADD COLUMN IF NOT EXISTS min_agendas_day INTEGER NOT NULL DEFAULT 7;
