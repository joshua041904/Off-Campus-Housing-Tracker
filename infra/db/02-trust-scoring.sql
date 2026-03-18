-- Trust: deterministic reputation score formula and trigger. Run after 01-trust-schema.sql on port 5446.
-- Formula: score = LEAST(GREATEST(average_rating*0.6 + completed_bookings*0.2 - flags_count*0.3, 0), 5)
-- average_rating from positive_reviews/(positive+negative) as 1-5 scale (positive=good, negative=bad): 5*pos/(pos+neg) when total>0 else 0.

-- Allow fractional score (proto uses float)
ALTER TABLE trust.reputation
  ALTER COLUMN reputation_score TYPE NUMERIC(4,2) USING reputation_score::NUMERIC(4,2),
  ALTER COLUMN reputation_score SET DEFAULT 0;

CREATE OR REPLACE FUNCTION trust.compute_reputation_score(
  p_positive_reviews INT,
  p_negative_reviews INT,
  p_completed_bookings INT,
  p_flags_count INT
) RETURNS NUMERIC(4,2) AS $$
DECLARE
  total_reviews INT;
  avg_rating NUMERIC(4,2);
  raw_score NUMERIC(10,4);
BEGIN
  total_reviews := p_positive_reviews + p_negative_reviews;
  IF total_reviews > 0 THEN
    avg_rating := (5.0 * p_positive_reviews) / total_reviews;
  ELSE
    avg_rating := 0;
  END IF;
  raw_score := (avg_rating * 0.6)
             + (LEAST(p_completed_bookings, 50) * 0.2)  -- cap bookings contribution
             - (LEAST(p_flags_count, 20) * 0.3);
  RETURN LEAST(GREATEST(ROUND(raw_score::NUMERIC(4,2), 2), 0), 5.00);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION trust.compute_reputation_score(INT,INT,INT,INT) IS 'Deterministic trust score 0-5: average_rating*0.6 + completed_bookings*0.2 - flags_count*0.3. Event-driven updates: booking.completed, review.created, flags.';

CREATE OR REPLACE FUNCTION trust.set_reputation_score()
RETURNS TRIGGER AS $$
BEGIN
  NEW.reputation_score := trust.compute_reputation_score(
    NEW.positive_reviews,
    NEW.negative_reviews,
    NEW.completed_bookings,
    NEW.flags_count
  );
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_reputation_compute_score ON trust.reputation;
CREATE TRIGGER tr_reputation_compute_score
  BEFORE INSERT OR UPDATE OF positive_reviews, negative_reviews, completed_bookings, flags_count
  ON trust.reputation
  FOR EACH ROW
  EXECUTE PROCEDURE trust.set_reputation_score();

-- Backfill existing rows with computed score
UPDATE trust.reputation
SET reputation_score = trust.compute_reputation_score(positive_reviews, negative_reviews, completed_bookings, flags_count);

-- updated_at trigger remains from 01 (tr_reputation_updated_at)
