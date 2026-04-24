/**
 * Maps authentication errors to user-friendly messages.
 * Normalizes both API errors and unexpected failures.
 */
export function mapAuthError(err: unknown, fallback = "Something went wrong. Please try again."): string {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (msg.includes("invalid email") || msg.includes("invalid password") || msg.includes("invalid_credentials") || msg.includes("incorrect email")) {
      return "Incorrect email or password.";
    }
    if (msg.includes("already exists") || msg.includes("409")) {
      return "An account with this email already exists.";
    }
    if (msg.includes("400")) {
      return "Invalid email or password format.";
    }
    if (msg.includes("mfa required")) {
      return "MFA required — use a test account without MFA for the webapp demo.";
    }
    if (msg.includes("no token")) {
      return "Authentication failed. Please try again.";
    }
    if (err.message && !msg.includes("failed:") && !msg.includes("status")) {
      return err.message;
    }
  }
  return fallback;
}
