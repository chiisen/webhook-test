const Redis = require('ioredis');

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || null;
const REDIS_DB = parseInt(process.env.REDIS_DB || '0', 10);
const RATE_LIMIT_WINDOW = parseInt(process.env.RATE_LIMIT_WINDOW || '60', 10);
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT || '60', 10);

let redis = null;
let useRedis = false;

const initRedis = () => {
  if (redis) return redis;

  try {
    redis = new Redis({
      host: REDIS_HOST,
      port: REDIS_PORT,
      password: REDIS_PASSWORD,
      db: REDIS_DB,
      retryStrategy: (times) => {
        if (times > 3) {
          console.warn('Redis connection failed, falling back to in-memory rate limit');
          return null;
        }
        return Math.min(times * 100, 3000);
      },
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
      lazyConnect: true
    });

    redis.on('connect', () => {
      console.log('Redis connected for rate limiting');
      useRedis = true;
    });

    redis.on('error', (err) => {
      console.warn('Redis error:', err.message);
      useRedis = false;
    });

    redis.connect().catch(() => {
      console.warn('Redis connection failed, using in-memory rate limit');
    });
  } catch (error) {
    console.warn('Redis initialization failed:', error.message);
  }

  return redis;
};

const inMemoryStore = {};
setInterval(() => {
  const now = Date.now();
  Object.keys(inMemoryStore).forEach((ip) => {
    const windowStart = now - RATE_LIMIT_WINDOW * 1000;
    inMemoryStore[ip] = inMemoryStore[ip].filter((ts) => ts > windowStart);
    if (inMemoryStore[ip].length === 0) {
      delete inMemoryStore[ip];
    }
  });
}, RATE_LIMIT_WINDOW * 1000);

const checkRateLimit = async (ip) => {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW * 1000;

  if (useRedis && redis) {
    try {
      const key = `ratelimit:${ip}`;
      const count = await redis.incr(key);

      if (count === 1) {
        await redis.expire(key, RATE_LIMIT_WINDOW);
      }

      return {
        allowed: count <= RATE_LIMIT_MAX,
        current: count,
        limit: RATE_LIMIT_MAX,
        remaining: Math.max(0, RATE_LIMIT_MAX - count)
      };
    } catch (error) {
      console.warn('Redis rate limit check failed:', error.message);
    }
  }

  if (!inMemoryStore[ip]) {
    inMemoryStore[ip] = [];
  }
  inMemoryStore[ip] = inMemoryStore[ip].filter((ts) => ts > windowStart);
  inMemoryStore[ip].push(now);

  const count = inMemoryStore[ip].length;
  return {
    allowed: count <= RATE_LIMIT_MAX,
    current: count,
    limit: RATE_LIMIT_MAX,
    remaining: Math.max(0, RATE_LIMIT_MAX - count)
  };
};

const getRateLimitStats = async () => {
  if (useRedis && redis) {
    try {
      const keys = await redis.keys('ratelimit:*');
      const stats = [];
      for (const key of keys) {
        const ip = key.replace('ratelimit:', '');
        const count = await redis.get(key);
        stats.push({ ip, count: parseInt(count, 10) });
      }
      return { useRedis: true, stats };
    } catch (error) {
      return { useRedis: false, error: error.message };
    }
  }
  return {
    useRedis: false,
    stats: Object.entries(inMemoryStore).map(([ip, times]) => ({
      ip,
      count: times.length
    }))
  };
};

const resetRateLimit = async (ip) => {
  if (useRedis && redis) {
    try {
      await redis.del(`ratelimit:${ip}`);
      return true;
    } catch (error) {
      return false;
    }
  }
  delete inMemoryStore[ip];
  return true;
};

const closeRedis = async () => {
  if (redis) {
    await redis.quit();
    redis = null;
    useRedis = false;
  }
};

initRedis();

module.exports = {
  checkRateLimit,
  getRateLimitStats,
  resetRateLimit,
  closeRedis,
  get isUsingRedis() {
    return useRedis;
  }
};
