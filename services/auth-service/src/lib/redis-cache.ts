/**
 * Redis Cache with Lua Scripts for User Lookups
 * 
 * Implements efficient caching with atomic operations using Lua scripts.
 * This reduces database load and improves authentication performance.
 */

import { createClient, RedisClientType } from 'redis';

// Redis client (shared instance)
let redisClient: RedisClientType | null = null;

// Initialize Redis client
export function getRedisClient(): RedisClientType | null {
  if (redisClient) {
    return redisClient;
  }

  try {
    let REDIS_URL = process.env.REDIS_URL || "redis://redis:6379/0";
    const rawPassword = process.env.REDIS_PASSWORD;
    const REDIS_PASSWORD = rawPassword && String(rawPassword).trim() ? rawPassword : undefined;
    
    if (REDIS_PASSWORD && !REDIS_URL.includes('@') && !REDIS_URL.includes('://:')) {
      REDIS_URL = REDIS_URL.replace('redis://', `redis://:${REDIS_PASSWORD}@`);
    }

    redisClient = createClient({
      url: REDIS_URL,
      socket: { connectTimeout: 10_000 },
    }) as RedisClientType;
    
    redisClient.on('error', (err) => {
      console.warn('[auth-redis] Redis error (non-fatal):', err.message);
    });

    // Connect asynchronously (don't block startup)
    (async () => {
      try {
        await redisClient!.connect();
        console.log('[auth-redis] Redis connected for caching');
      } catch (err) {
        console.warn('[auth-redis] Redis connection failed (continuing without cache):', err);
        redisClient = null;
      }
    })();

    return redisClient;
  } catch (err) {
    console.warn('[auth-redis] Redis initialization failed (continuing without cache):', err);
    return null;
  }
}

// Lua script for atomic user lookup with cache
// Returns: JSON string with user data or null
const USER_LOOKUP_SCRIPT = `
  local cacheKey = KEYS[1]
  local userKey = KEYS[2]
  
  -- Try to get from cache first
  local cached = redis.call('GET', cacheKey)
  if cached then
    -- Update TTL (refresh on access)
    redis.call('EXPIRE', cacheKey, ARGV[1])
    return cached
  end
  
  -- If not in cache, return nil (caller will fetch from DB and cache)
  return nil
`;

// Lua script for atomic user cache update
// Sets cache with TTL and returns success
const USER_CACHE_UPDATE_SCRIPT = `
  local cacheKey = KEYS[1]
  local userData = ARGV[1]
  local ttl = ARGV[2]
  
  -- Set cache with TTL
  redis.call('SETEX', cacheKey, ttl, userData)
  return 'OK'
`;

// Lua script for atomic cache invalidation
// Removes user from cache
const USER_CACHE_INVALIDATE_SCRIPT = `
  local cacheKey = KEYS[1]
  
  -- Remove from cache
  redis.call('DEL', cacheKey)
  return 'OK'
`;

// Cache TTL (5 minutes)
const CACHE_TTL = 300; // 5 minutes

/**
 * Get user from cache by email
 * Returns cached user data or null if not cached
 */
export async function getUserFromCache(email: string): Promise<{
  id: string;
  email: string;
  passwordHash: string;
  mfaEnabled: boolean;
  emailVerified: boolean;
  phoneVerified: boolean;
  createdAt: Date;
} | null> {
  const client = getRedisClient();
  if (!client || !client.isOpen) {
    return null;
  }

  try {
    const cacheKey = `user:email:${email.toLowerCase()}`;
    
    // Use Lua script for atomic lookup
    const result = await client.eval(USER_LOOKUP_SCRIPT, {
      keys: [cacheKey, `user:${cacheKey}`],
      arguments: [CACHE_TTL.toString()],
    });

    if (!result || result === null) {
      return null;
    }

    // Parse cached user data
    const userData = JSON.parse(result as string);
    return {
      ...userData,
      createdAt: new Date(userData.createdAt),
    };
  } catch (err) {
    // Silently fail - cache miss is not an error
    return null;
  }
}

/**
 * Cache user data
 */
export async function cacheUser(user: {
  id: string;
  email: string;
  passwordHash: string;
  mfaEnabled: boolean;
  emailVerified: boolean;
  phoneVerified: boolean;
  createdAt: Date;
}): Promise<void> {
  const client = getRedisClient();
  if (!client || !client.isOpen) {
    return;
  }

  try {
    const cacheKey = `user:email:${user.email.toLowerCase()}`;
    const userData = JSON.stringify({
      id: user.id,
      email: user.email,
      passwordHash: user.passwordHash,
      mfaEnabled: user.mfaEnabled,
      emailVerified: user.emailVerified,
      phoneVerified: user.phoneVerified,
      createdAt: user.createdAt.toISOString(),
    });

    // Use Lua script for atomic cache update
    await client.eval(USER_CACHE_UPDATE_SCRIPT, {
      keys: [cacheKey],
      arguments: [userData, CACHE_TTL.toString()],
    });
  } catch (err) {
    // Silently fail - cache write failure is not critical
    console.warn('[auth-redis] Failed to cache user:', err);
  }
}

/**
 * Invalidate user cache (on update/delete)
 */
export async function invalidateUserCache(email: string): Promise<void> {
  const client = getRedisClient();
  if (!client || !client.isOpen) {
    return;
  }

  try {
    const cacheKey = `user:email:${email.toLowerCase()}`;
    
    // Use Lua script for atomic invalidation
    await client.eval(USER_CACHE_INVALIDATE_SCRIPT, {
      keys: [cacheKey],
      arguments: [],
    });
  } catch (err) {
    // Silently fail
    console.warn('[auth-redis] Failed to invalidate cache:', err);
  }
}

/**
 * Check if email exists in cache (for registration check)
 */
export async function checkEmailExistsInCache(email: string): Promise<boolean> {
  const client = getRedisClient();
  if (!client || !client.isOpen) {
    return false;
  }

  try {
    const cacheKey = `user:email:${email.toLowerCase()}`;
    const exists = await client.exists(cacheKey);
    return exists === 1;
  } catch (err) {
    return false;
  }
}

/**
 * Get cache statistics (for monitoring)
 */
export async function getCacheStats(): Promise<{
  connected: boolean;
  userCacheKeys: number;
}> {
  const client = getRedisClient();
  if (!client || !client.isOpen) {
    return { connected: false, userCacheKeys: 0 };
  }

  try {
    // Count user cache keys (approximate)
    const keys = await client.keys('user:email:*');
    return {
      connected: true,
      userCacheKeys: keys.length,
    };
  } catch (err) {
    return { connected: false, userCacheKeys: 0 };
  }
}

