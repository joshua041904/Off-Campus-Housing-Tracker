#!/usr/bin/env node
/**
 * Reusable patterns for forcing failure branches in Vitest (import from tests via relative path).
 *
 * Usage (from a *.test.ts file, use the JS helpers or mirror in TS):
 *   import { withMockRejected } from "../../../scripts/testing/error-harness.mjs";
 *
 * Vitest / TypeScript tests typically copy the small snippets below inline; this module
 * documents the contract and offers runtime helpers for plain Node scripts.
 */

/**
 * @template T
 * @param {() => T} fn
 * @param {() => void} cleanup
 * @returns {Promise<T>}
 */
export async function withCleanup(fn, cleanup) {
  try {
    return await fn();
  } finally {
    cleanup();
  }
}

/**
 * Build a rejected Promise like a Kafka send failure.
 * @param {string} [msg]
 * @returns {Promise<never>}
 */
export function rejectedKafkaSend(msg = "kafka send failed") {
  return Promise.reject(new Error(msg));
}

/**
 * @param {string} [msg]
 */
export function rejectedDbQuery(msg = "db query failed") {
  return Promise.reject(new Error(msg));
}
