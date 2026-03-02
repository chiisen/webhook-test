require('dotenv').config();
const express = require('express');
const { exec } = require('child_process');
const crypto = require('crypto');
const { saveRequest, getHistory, searchHistory, getStats, closeDb } = require('./history');
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

// CORS middleware
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Token');
  if (req.method === 'OPTIONS') {
    return res.status(204).send();
  }
  next();
});

// IP Whitelist
const ipWhitelist = (req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress;
  const clientIp = ip.replace(/^::ffff:/, '');

  if (
    ALLOWED_IPS.length > 0 &&
    !ALLOWED_IPS.some((allowed) => clientIp === allowed.trim() || allowed.trim() === '*')
  ) {
    console.log(`${COLORS.RED}🚫 IP 被阻擋${COLORS.RESET} | IP: ${clientIp} | 不在白名單中`);
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

// Rate Limiting
const rateLimitStore = {};
setInterval(() => {
  Object.keys(rateLimitStore).forEach((ip) => (rateLimitStore[ip] = 0));
}, 60000);

const rateLimit = (req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress;
  rateLimitStore[ip] = (rateLimitStore[ip] || 0) + 1;

  if (rateLimitStore[ip] > RATE_LIMIT) {
    stats.blockedRequests++;
    console.log(
      `${COLORS.RED}🚫 請求被阻擋 - 超過限流次數${COLORS.RESET} | IP: ${ip} | 次數: ${rateLimitStore[ip]}/${RATE_LIMIT}/分鐘`
    );
    return res.status(429).json({ error: 'Too Many Requests' });
  }

  if (rateLimitStore[ip] > RATE_LIMIT * 0.8) {
    console.log(
      `${COLORS.YELLOW}⚠️  逼近限流閾值${COLORS.RESET} | IP: ${ip} | 次數: ${rateLimitStore[ip]}/${RATE_LIMIT}/分鐘`
    );
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
    console.log(`${COLORS.RED}⚠️  無效 Payload${COLORS.RESET} | 原因: 請求體為空或格式錯誤`);
    return res.status(400).json({ error: 'Invalid payload: empty or malformed JSON' });
  }

  const { status, alerts } = body;

  if (!status || !['firing', 'resolved'].includes(status)) {
    console.log(
      `${COLORS.RED}⚠️  無效 Payload${COLORS.RESET} | 原因: 缺少 status 欄位或值不正確 (firing/resolved)`
    );
    return res.status(400).json({ error: 'Invalid payload: missing or invalid status field' });
  }

  console.log(
    `${COLORS.GREEN}✅ Payload 驗證通過${COLORS.RESET} | status: ${status} | alerts: ${alerts?.length || 0} 個`
  );
  next();
};

// Log middleware with timestamp
app.use((req, res, next) => {
  const timestamp = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
  console.log(
    `${COLORS.DIM}[${timestamp}]${COLORS.RESET} ${COLORS.BLUE}[${req.id}]${COLORS.RESET} ${COLORS.GREEN}${req.method}${COLORS.RESET} ${COLORS.CYAN}${req.url}${COLORS.RESET}`
  );
  next();
});

app.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));

app.get('/stats', (req, res) => {
  const uptime = Math.floor((Date.now() - stats.startTime) / 1000);
  res.status(200).json({
    totalRequests: stats.totalRequests,
    blockedRequests: stats.blockedRequests,
    uptimeSeconds: uptime
  });
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

app.post('/test', ipWhitelist, rateLimit, validateToken, validatePayload, (req, res) => {
  stats.totalRequests++;
  console.log(`${COLORS.YELLOW}收到 Grafana 通知:${COLORS.RESET}`);

  const alerts = req.body.alerts || [];
  const filteredAlerts = filterAlerts(alerts);

  if (filteredAlerts.length !== alerts.length) {
    console.log(
      `${COLORS.CYAN}過濾後 Alert 數量: ${filteredAlerts.length} / ${alerts.length}${COLORS.RESET}`
    );
  }

  console.dir(req.body, { depth: null, colors: true });

  if (req.body && req.body.status === 'firing' && filteredAlerts.length > 0) {
    if (process.platform === 'darwin') {
      const soundName = ALERT_SOUND;
      const volume = ALERT_VOLUME;
      const soundPath = `/System/Library/Sounds/${soundName}.aiff`;

      exec(`afplay -v ${volume} "${soundPath}"`, (err) => {
        if (err) console.error('無法播放音效:', err);
      });
    }
  }

  const endTimestamp = new Date().toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei',
    hour12: false
  });
  console.log(`${COLORS.MAGENTA}接收完成時間: ${endTimestamp}${COLORS.RESET}\n`);

  saveRequest(req, res, req.body);

  res.status(200).json({ status: 'ok', message: 'received' });
});

// Error handling middleware
app.use((err, req, res, _next) => {
  console.error(`${COLORS.RED}❌ 發生錯誤:${COLORS.RESET}`, err.message);
  res.status(400).send('Bad Request');
});

// Start server if run directly
if (require.main === module) {
  const server = app.listen(PORT, () => {
    console.log(`${COLORS.GREEN}伺服器啟動在 http://localhost:${PORT}/test${COLORS.RESET}`);
  });

  const shutdown = (signal) => {
    console.log(`${COLORS.YELLOW}收到 ${signal}，正在關閉伺服器...${COLORS.RESET}`);
    closeDb();
    server.close(() => {
      console.log(`${COLORS.GREEN}伺服器已關閉${COLORS.RESET}`);
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

module.exports = app;
