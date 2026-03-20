-- singleflight_cache.lua
-- KEYS[1]=dataKey, KEYS[2]=lockKey
-- ARGV[1]=ttlSec, ARGV[2]=nowMs, ARGV[3]=staleMs
-- Returns: {state, value} where state ∈ {"hit","miss-locked","miss-wait"}

local dk = KEYS[1]
local lk = KEYS[2]
local ttl = tonumber(ARGV[1])
local now = tonumber(ARGV[2])
local stale = tonumber(ARGV[3])

local v = redis.call("GET", dk)
if v then
  local mt = redis.call("PTTL", dk)
  if mt > 0 then
    return {"hit", v}
  end
end

-- try acquire lock for recompute
local ok = redis.call("SET", lk, "1", "NX", "PX", 10000)
if ok then
  return {"miss-locked", ""}
else
  return {"miss-wait", ""}
end
