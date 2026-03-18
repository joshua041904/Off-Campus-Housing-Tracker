-- Booking: enforce legal state transitions at DB level. Run after 01-booking-schema.sql on port 5443.
-- Legal: created → pending_confirmation | cancelled; pending_confirmation → confirmed | rejected | cancelled | expired;
--        confirmed → completed | cancelled. Terminal: rejected, cancelled, expired, completed (no further transitions).

CREATE OR REPLACE FUNCTION booking.enforce_booking_transition()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  -- created → pending_confirmation (submit to landlord) or cancelled
  IF OLD.status = 'created' AND NEW.status IN ('pending_confirmation', 'cancelled') THEN
    RETURN NEW;
  END IF;

  -- pending_confirmation → confirmed | rejected | cancelled | expired
  IF OLD.status = 'pending_confirmation' AND NEW.status IN ('confirmed', 'rejected', 'cancelled', 'expired') THEN
    RETURN NEW;
  END IF;

  -- confirmed → completed | cancelled
  IF OLD.status = 'confirmed' AND NEW.status IN ('completed', 'cancelled') THEN
    RETURN NEW;
  END IF;

  -- Terminal states: no transitions out
  IF OLD.status IN ('rejected', 'cancelled', 'expired', 'completed') THEN
    RAISE EXCEPTION 'Illegal booking state transition from terminal state % to %', OLD.status, NEW.status;
  END IF;

  RAISE EXCEPTION 'Illegal booking state transition from % to %', OLD.status, NEW.status;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_booking_state_transition ON booking.bookings;
CREATE TRIGGER tr_booking_state_transition
  BEFORE UPDATE ON booking.bookings
  FOR EACH ROW
  EXECUTE PROCEDURE booking.enforce_booking_transition();

COMMENT ON FUNCTION booking.enforce_booking_transition() IS 'Enforces legal booking lifecycle transitions; terminal states (rejected, cancelled, expired, completed) allow no further changes.';
