import IORedis from "ioredis";

/**
 * Shared Redis connection for OmniAccess (BullMQ dispatch queue + app use).
 * Redis runs locally on the app host, bound to 127.0.0.1 (protected-mode on).
 * Override with REDIS_URL if Redis ever moves to its own LXC.
 */
export const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";

// BullMQ requires `maxRetriesPerRequest: null` on its connection.
export function makeRedisConnection(): IORedis {
    return new IORedis(REDIS_URL, {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
    });
}

declare global {
    // eslint-disable-next-line no-var
    var __omniRedis: IORedis | undefined;
}

/** Singleton connection for general app reads/writes (not for BullMQ workers). */
export function getRedis(): IORedis {
    if (!global.__omniRedis) global.__omniRedis = makeRedisConnection();
    return global.__omniRedis;
}
