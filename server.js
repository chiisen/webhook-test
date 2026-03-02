require('dotenv').config();
const express = require('express');
const { exec } = require('child_process');
const crypto = require('crypto');
const { saveRequest, getHistory, searchHistory, getStats, closeDb } = require('./history');
const { logger, logRequest, logAlert, logBlocked, closeLogger } = require('./logger');
const {
  checkRateLimit,
  getRateLimitStats,
  resetRateLimit,
  closeRedis,
  isUsingRedis
} = require('./rateLimiter');
const { forwardWebhook, getForwardConfig, testForward } = require('./webhookForward');
const {
  verifyCortexSignature,
  addToBlacklist,
  removeFromBlacklist,
  isBlacklisted,
  getBlacklist,
  recordViolation,
  getSecurityConfig,
  setLogger
} = require('./security');
const app = express();
const {
  PORT,
  RATE_LIMIT,
  BODY_LIMIT,
  ALLOWED_IPS,
  API_TOKEN,
  ALERT_SOUND,
  ALERT_VOLUME,
  FILTER_LABELS,
  FILTER_MODE,
  COLORS
} = require('./config');

setLogger(logger);

// CORS middleware
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Token, X-Cortex-Signature');
  if (req.method === 'OPTIONS') {
    return res.status(204).send();
  }
  next();
});

// IP Blacklist Check
const checkBlacklist = (req, res, next) => {
  const ip = req.ip || req.connection?.remoteAddress || req.ip;
  const clientIp = ip.replace(/^::ffff:/, '');

  if (isBlacklisted(clientIp)) {
    logger.warn({ ip: clientIp }, 'Blocked request from blacklisted IP');
    recordViolation(clientIp, 'blacklisted');
    return res.status(403).json({ error: 'Forbidden: IP is blacklisted' });
  }
  next();
};

// IP Whitelist
const ipWhitelist = (req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress;
  const clientIp = ip.replace(/^::ffff:/, '');

  if (
    ALLOWED_IPS.length > 0 &&
    !ALLOWED_IPS.some((allowed) => clientIp === allowed.trim() || allowed.trim() === '*')
  ) {
    logBlocked('ip_whitelist', clientIp, '不在白名單中');
    logger.info({ ip: clientIp, reason: 'ip_whitelist' }, 'IP 被阻擋');
    return res.status(403).json({ error: 'Forbidden: IP not allowed' });
  }
  next();
};

app.use(express.json({ limit: BODY_LIMIT }));

// Statistics
const stats = {
  totalRequests: 0,
  blockedRequests: 0,
  startTime: Date.now()
};

// Rate Limiting (Redis-based)
const rateLimit = async (req, res, next) => {
  const ip = req.ip || req.connection?.remoteAddress || req.ip;
  const result = await checkRateLimit(ip);

  if (!result.allowed) {
    stats.blockedRequests++;
    recordViolation(ip, 'rate_limit');
    logBlocked('rate_limit', ip, `次數: ${result.current}/${result.limit}/分鐘`);
    res.setHeader('X-RateLimit-Limit', result.limit);
    res.setHeader('X-RateLimit-Remaining', 0);
    res.setHeader('X-RateLimit-Reset', Math.floor(Date.now() / 1000) + 60);
    return res.status(429).json({
      error: 'Too Many Requests',
      limit: result.limit,
      remaining: 0
    });
  }

  res.setHeader('X-RateLimit-Limit', result.limit);
  res.setHeader('X-RateLimit-Remaining', result.remaining);
  res.setHeader('X-RateLimit-Reset', Math.floor(Date.now() / 1000) + 60);

  if (result.current > RATE_LIMIT * 0.8) {
    logger.warn({ ip, count: result.current, limit: result.limit }, '逼近限流閾值');
  }

  next();
};

// Request ID middleware
app.use((req, res, next) => {
  req.id = crypto.randomUUID().slice(0, 8);
  res.setHeader('X-Request-ID', req.id);
  next();
});

// API Token validation (skip for /health)
const validateToken = (req, res, next) => {
  const token = req.headers['x-api-token'];
  const expectedToken = API_TOKEN;

  if (expectedToken && token !== expectedToken) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

// Payload validation for Grafana webhook
const validatePayload = (req, res, next) => {
  const body = req.body;

  if (!body || typeof body !== 'object') {
    logger.warn({ reason: '請求體為空或格式錯誤' }, '無效 Payload');
    return res.status(400).json({ error: 'Invalid payload: empty or malformed JSON' });
  }

  const { status, alerts } = body;

  if (!status || !['firing', 'resolved'].includes(status)) {
    logger.warn({ status, reason: '缺少 status 欄位或值不正確' }, '無效 Payload');
    return res.status(400).json({ error: 'Invalid payload: missing or invalid status field' });
  }

  logger.info({ status, alertsCount: alerts?.length || 0 }, 'Payload 驗證通過');
  next();
};

// Log middleware with timestamp
app.use((req, res, next) => {
  req.startTime = Date.now();
  logger.info({ method: req.method, url: req.url, requestId: req.id }, 'HTTP Request');
  next();
});

// Cortex Signature validation middleware
const validateCortexSignature = (req, res, next) => {
  const signature = req.headers['x-cortex-signature'];
  const result = verifyCortexSignature(req.body, signature);

  if (!result.valid) {
    logger.warn({ reason: result.reason }, 'Cortex signature validation failed');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  next();
};

app.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));

app.get('/stats', (req, res) => {
  const uptime = Math.floor((Date.now() - stats.startTime) / 1000);
  res.status(200).json({
    totalRequests: stats.totalRequests,
    blockedRequests: stats.blockedRequests,
    uptimeSeconds: uptime,
    rateLimitEngine: isUsingRedis ? 'redis' : 'memory'
  });
});

app.get('/security/config', (req, res) => {
  res.status(200).json(getSecurityConfig());
});

app.get('/blacklist', (req, res) => {
  res.status(200).json({ blacklist: getBlacklist() });
});

app.post('/blacklist', (req, res) => {
  const { ip, reason } = req.body;
  if (!ip) {
    return res.status(400).json({ error: 'Missing ip parameter' });
  }
  addToBlacklist(ip, reason || 'manual');
  res.status(200).json({ success: true, ip });
});

app.delete('/blacklist/:ip', (req, res) => {
  const { ip } = req.params;
  removeFromBlacklist(ip);
  res.status(200).json({ success: true, ip });
});

app.get('/ratelimit/stats', async (req, res) => {
  try {
    const rateStats = await getRateLimitStats();
    res.status(200).json(rateStats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/ratelimit/:ip', async (req, res) => {
  const { ip } = req.params;
  const success = await resetRateLimit(ip);
  res.status(success ? 200 : 500).json({ success, ip });
});

app.get('/forward/config', (req, res) => {
  res.status(200).json(getForwardConfig());
});

app.post('/forward/test', async (req, res) => {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }
  const result = await testForward(url);
  res.status(200).json(result);
});

app.get('/history', async (req, res) => {
  const limit = parseInt(req.query.limit || '100', 10);
  const history = await getHistory(limit);
  res.status(200).json({ history });
});

app.get('/history/search', async (req, res) => {
  const limit = parseInt(req.query.limit || '100', 10);
  const filters = {
    status: req.query.status,
    ip: req.query.ip,
    url: req.query.url,
    limit
  };
  const history = await searchHistory(filters);
  res.status(200).json({ history });
});

app.get('/history/stats', async (req, res) => {
  try {
    const historyStats = await getStats();
    res.status(200).json(historyStats);
  } catch (err) {
    console.error(`${COLORS.RED}❌ 取得統計資料失敗:${COLORS.RESET}`, err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Alert filter based on labels
const filterAlerts = (alerts) => {
  if (FILTER_LABELS.length === 0) {
    return alerts;
  }

  return alerts.filter((alert) => {
    const labels = alert.labels || {};
    const hasMatch = FILTER_LABELS.some((label) => labels[label]);

    if (FILTER_MODE === 'block') {
      return !hasMatch;
    }
    return hasMatch;
  });
};

app.post(
  '/test',
  checkBlacklist,
  ipWhitelist,
  rateLimit,
  validateCortexSignature,
  validateToken,
  validatePayload,
  async (req, res) => {
    stats.totalRequests++;
    logger.info({ status: req.body.status }, '收到 Grafana 通知');

    const alerts = req.body.alerts || [];
    const filteredAlerts = filterAlerts(alerts);

    if (filteredAlerts.length !== alerts.length) {
      logger.info({ original: alerts.length, filtered: filteredAlerts.length }, 'Alert 數量過濾');
    }

    logger.debug({ payload: req.body }, 'Request Body');

    if (req.body && req.body.status === 'firing' && filteredAlerts.length > 0) {
      if (process.platform === 'darwin') {
        const soundName = ALERT_SOUND;
        const volume = ALERT_VOLUME;
        const soundPath = `/System/Library/Sounds/${soundName}.aiff`;

        exec(`afplay -v ${volume} "${soundPath}"`, (err) => {
          if (err) logger.error({ error: err.message }, '無法播放音效');
        });
      }
    }

    const forwardResult = await forwardWebhook(req.body);
    if (!forwardResult.success && forwardResult.error !== 'Forwarding is disabled') {
      logger.warn({ error: forwardResult.error }, 'Webhook 轉發失敗');
    }

    logAlert(req.body.status, alerts.length, filteredAlerts.length);
    saveRequest(req, res, req.body);

    res.status(200).json({
      status: 'ok',
      message: 'received',
      forwarded: forwardResult.success ? forwardResult.total : 0
    });
  }
);

// Error handling middleware
app.use((err, req, res, _next) => {
  logger.error({ error: err.message, stack: err.stack }, '發生錯誤');
  res.status(400).send('Bad Request');
});

// Start server if run directly
if (require.main === module) {
  const server = app.listen(PORT, () => {
    logger.info({ port: PORT }, '伺服器啟動');
  });

  const shutdown = async (signal) => {
    logger.info({ signal }, '收到關閉訊號，正在關閉伺服器');
    closeDb();
    await closeRedis();
    await closeLogger();
    server.close(() => {
      logger.info('伺服器已關閉');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

module.exports = app;
