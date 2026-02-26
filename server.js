require('dotenv').config();
const express = require('express');
const { exec } = require('child_process');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 9999;

// ANSI Color Codes
const COLORS = {
  RESET: "\x1b[0m",
  CYAN: "\x1b[36m",
  GREEN: "\x1b[32m",
  YELLOW: "\x1b[33m",
  RED: "\x1b[31m",
  MAGENTA: "\x1b[35m",
  DIM: "\x1b[2m"
};

app.use(express.json());

// Log middleware with timestamp
app.use((req, res, next) => {
  const timestamp = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
  console.log(`${COLORS.DIM}[${timestamp}]${COLORS.RESET} ${COLORS.GREEN}${req.method}${COLORS.RESET} ${COLORS.CYAN}${req.url}${COLORS.RESET}`);
  next();
});

app.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));

app.post('/test', (req, res) => {
  console.log(`${COLORS.YELLOW}🚀 收到 Grafana 通知:${COLORS.RESET}`);
  // console.dir supports colored output natively
  console.dir(req.body, { depth: null, colors: true });

  // Play sound if status is firing
  if (req.body && req.body.status === 'firing') {
    // Check if running on macOS
    if (process.platform === 'darwin') {
      const soundName = process.env.ALERT_SOUND || 'Glass';
      const volume = process.env.ALERT_VOLUME || '1';
      const soundPath = `/System/Library/Sounds/${soundName}.aiff`;

      // macOS system sound with volume control
      exec(`afplay -v ${volume} "${soundPath}"`, (err) => {
        if (err) console.error('無法播放音效:', err);
      });
    }
  }

  const endTimestamp = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
  console.log(`${COLORS.MAGENTA}⏱️  接收完成時間: ${endTimestamp}${COLORS.RESET}\n`);

  res.status(200).send('OK');
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(`${COLORS.RED}❌ 發生錯誤:${COLORS.RESET}`, err.message);
  res.status(400).send('Bad Request');
});

app.listen(PORT, () => {
  console.log(`${COLORS.GREEN}伺服器啟動在 http://localhost:${PORT}/test${COLORS.RESET}`);
});
