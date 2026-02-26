require('dotenv').config();
const express = require('express');
const { exec } = require('child_process');
const crypto = require('crypto');
const app = express();
const PORT = process.env.PORT || 9999;
const RATE_LIMIT = parseInt(process.env.RATE_LIMIT || '60');

// ANSI Color Codes
const COLORS = {
  RESET: "\x1b[0m",
  CYAN: "\x1b[36m",
  GREEN: "\x1b[32m",
  YELLOW: "\x1b[33m",
  RED: "\x1b[31m",
  MAGENTA: "\x1b[35m",
  DIM: "\x1b[2m",
  BLUE: "\x1b[34m"
};

app.use(express.json());

// Rate Limiting
const rateLimitStore = {};
setInterval(() => {
  Object.keys(rateLimitStore).forEach(ip => rateLimitStore[ip] = 0);
}, 60000);

const rateLimit = (req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress;
  rateLimitStore[ip] = (rateLimitStore[ip] || 0) + 1;
  
  if (rateLimitStore[ip] > RATE_LIMIT) {
    console.log(`${COLORS.RED}🚫 請求被阻擋 - 超過限流次數${COLORS.RESET} | IP: ${ip} | 次數: ${rateLimitStore[ip]}/${RATE_LIMIT}/分鐘`);
    return res.status(429).json({ error: 'Too Many Requests' });
  }
  
  if (rateLimitStore[ip] > RATE_LIMIT * 0.8) {
    console.log(`${COLORS.YELLOW}⚠️  逼近限流閾值${COLORS.RESET} | IP: ${ip} | 次數: ${rateLimitStore[ip]}/${RATE_LIMIT}/分鐘`);
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
  const expectedToken = process.env.API_TOKEN;
  
  if (expectedToken && token !== expectedToken) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

// Log middleware with timestamp
app.use((req, res, next) => {
  const timestamp = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
  console.log(`${COLORS.DIM}[${timestamp}]${COLORS.RESET} ${COLORS.BLUE}[${req.id}]${COLORS.RESET} ${COLORS.GREEN}${req.method}${COLORS.RESET} ${COLORS.CYAN}${req.url}${COLORS.RESET}`);
  next();
});

app.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));

app.post('/test', rateLimit, validateToken, (req, res) => {
  console.log(`${COLORS.YELLOW}🚀 收到 Grafana 通知:${COLORS.RESET}`);
  console.dir(req.body, { depth: null, colors: true });

  if (req.body && req.body.status === 'firing') {
    if (process.platform === 'darwin') {
      const soundName = process.env.ALERT_SOUND || 'Glass';
      const volume = process.env.ALERT_VOLUME || '1';
      const soundPath = `/System/Library/Sounds/${soundName}.aiff`;

      exec(`afplay -v ${volume} "${soundPath}"`, (err) => {
        if (err) console.error('無法播放音效:', err);
      });
    }
  }

  const endTimestamp = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
  console.log(`${COLORS.MAGENTA}⏱️  接收完成時間: ${endTimestamp}${COLORS.RESET}\n`);

  res.status(200).json({ status: 'ok', message: 'received' });
});

// Error handling middleware
app.use((err, req, res, next) => {
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
    server.close(() => {
      console.log(`${COLORS.GREEN}伺服器已關閉${COLORS.RESET}`);
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

module.exports = app;
