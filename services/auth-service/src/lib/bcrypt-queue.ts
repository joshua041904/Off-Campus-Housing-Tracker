/**
 * bcrypt Queue Manager
 * 
 * Prevents CPU contention by limiting concurrent bcrypt operations.
 * This ensures that bcrypt.hash doesn't block the event loop and
 * prevents multiple concurrent registrations from overwhelming the CPU.
 */

import bcrypt from "bcryptjs";

// Configuration
// With 2000m CPU limit (2 cores) per pod, we can handle 32-64 concurrent bcrypt operations
// With 4 replicas, total concurrent bcrypt = 128-256 operations
// bcrypt is async and CPU-bound, so we can queue more operations per core
// Increased to 64 to handle high load (500+ VUs) and prevent queue saturation
const MAX_CONCURRENT_BCRYPT = 64; // Increased from 32 to 64 for better throughput under high load
const BCRYPT_ROUNDS = 8; // Reduced from 10 for better performance (still secure)

// Simple semaphore to limit concurrent operations
let activeOperations = 0;
const waitingQueue: Array<{
  resolve: (value: string) => void;
  reject: (error: Error) => void;
  password: string;
}> = [];

/**
 * Process the next item in the queue if we have capacity
 */
function processQueue() {
  if (activeOperations >= MAX_CONCURRENT_BCRYPT || waitingQueue.length === 0) {
    return;
  }

  const item = waitingQueue.shift();
  if (!item) return;

  activeOperations++;
  
  // Hash the password
  bcrypt.hash(item.password, BCRYPT_ROUNDS)
    .then((hash) => {
      activeOperations--;
      item.resolve(hash);
      // Process next item in queue
      processQueue();
    })
    .catch((error) => {
      activeOperations--;
      item.reject(error);
      // Process next item in queue
      processQueue();
    });
}

/**
 * Hash a password using bcrypt with queue management
 * This prevents CPU contention by limiting concurrent operations
 * 
 * @param password - The password to hash
 * @returns Promise<string> - The hashed password
 */
export async function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    waitingQueue.push({ resolve, reject, password });
    processQueue();
  });
}

/**
 * Compare a password with a hash
 * This doesn't need queuing as it's much faster than hashing
 * 
 * @param password - The plain text password
 * @param hash - The hashed password to compare against
 * @returns Promise<boolean> - True if passwords match
 */
export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Get the current queue status (for monitoring)
 */
export function getQueueStatus(): {
  activeOperations: number;
  queueLength: number;
  maxConcurrent: number;
  rounds: number;
} {
  return {
    activeOperations,
    queueLength: waitingQueue.length,
    maxConcurrent: MAX_CONCURRENT_BCRYPT,
    rounds: BCRYPT_ROUNDS,
  };
}

