/**
 * Maps authentication errors to user-friendly messages.
 * Whitelists known safe messages — never surfaces arbitrary backend errors.
 */

const SAFE_LOGIN_MESSAGES = [
  "Incorrect email or password.",
  "No account found with this email.",
  "Invalid email or password format.",
  "MFA required — use a test account without MFA for the webapp demo.",
  "Authentication failed. Please try again.",
];

const SAFE_REGISTER_MESSAGES = [
  "An account with this email already exists.",
  "Invalid email or password format.",
  "Something went wrong. Please try again.",
];

const ALL_SAFE_MESSAGES = [...SAFE_LOGIN_MESSAGES, ...SAFE_REGISTER_MESSAGES];

export function mapAuthError(err: unknown, fallback = "Something went wrong. Please try again."): string {
  if (!(err instanceof Error)) return fallback;

  const msg = err.message.toLowerCase();

  // Map known error patterns to whitelisted messages
  if (msg.includes("invalid_credentials") || msg.includes("incorrect email") || msg.includes("invalid email or password")) {
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

  // Only surface the message if it's in the whitelist
  if (ALL_SAFE_MESSAGES.includes(err.message)) {
    return err.message;
  }

  return fallback;
}
