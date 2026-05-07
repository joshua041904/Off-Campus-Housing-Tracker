/**
 * Branch-forcing helpers for auth-service Vitest suites.
 * Pattern: every external dependency gets success / throw / timeout / edge-return mocks.
 */
import { vi } from "vitest";

export function mockResolved<T>(v: T) {
  return vi.fn().mockResolvedValue(v);
}

export function mockRejected(err: unknown) {
  return vi.fn().mockRejectedValue(err);
}

/** Never settles — use for timeout branches (short test timeouts elsewhere). */
export function mockHang() {
  return vi.fn().mockImplementation(() => new Promise(() => {}));
}

export function mockResolvedOnceThen<T>(first: T, then: T) {
  return vi.fn().mockResolvedValueOnce(first).mockResolvedValue(then);
}
