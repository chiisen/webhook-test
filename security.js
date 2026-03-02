const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CORTEX_SECRET = process.env.CORTEX_SECRET || '';
const BLACKLIST_FILE = process.env.BLACKLIST_FILE || './blacklist.json';
const AUTO_BLACKLIST_THRESHOLD = parseInt(process.env.AUTO_BLACKLIST_THRESHOLD || '10', 10);
const AUTO_BLACKLIST_WINDOW = parseInt(process.env.AUTO_BLACKLIST_WINDOW || '300', 10);

let blacklist = new Set();
let violationCounts = {};

const loadBlacklist = () => {
  try {
    if (fs.existsSync(BLACKLIST_FILE)) {
      const data = fs.readFileSync(BLACKLIST_FILE, 'utf-8');
      const list = JSON.parse(data);
      blacklist = new Set(list);
      console.log(`Loaded ${blacklist.size} blacklisted IPs`);
    }
  } catch (error) {
    console.warn('Failed to load blacklist:', error.message);
  }
};

const saveBlacklist = () => {
  try {
    const data = JSON.stringify([...blacklist], null, 2);
    fs.writeFileSync(BLACKLIST_FILE, data);
  } catch (error) {
    console.error('Failed to save blacklist:', error.message);
  }
};

const addToBlacklist = (ip, reason = 'manual') => {
  blacklist.add(ip);
  console.log(`IP ${ip} added to blacklist (${reason})`);
  saveBlacklist();
  return true;
};

const removeFromBlacklist = (ip) => {
  blacklist.delete(ip);
  saveBlacklist();
  return true;
};

const isBlacklisted = (ip) => {
  return blacklist.has(ip);
};

const getBlacklist = () => {
  return [...blacklist];
};

const autoBlacklistCheck = (ip) => {
  const now = Date.now();
  const windowStart = now - AUTO_BLACKLIST_WINDOW * 1000;

  if (!violationCounts[ip]) {
    violationCounts[ip] = [];
  }

  violationCounts[ip] = violationCounts[ip].filter((ts) => ts > windowStart);
  violationCounts[ip].push(now);

  const count = violationCounts[ip].length;

  if (count >= AUTO_BLACKLIST_THRESHOLD && !blacklist.has(ip)) {
    addToBlacklist(ip, `auto: ${count} violations in ${AUTO_BLACKLIST_WINDOW}s`);
    return { blacklisted: true, reason: `Too many violations (${count})` };
  }

  return { blacklisted: false, violations: count };
};

const recordViolation = (ip, type) => {
  const result = autoBlacklistCheck(ip);
  if (result.blacklisted) {
    logger?.warn({ ip, type, reason: result.reason }, 'IP auto-blacklisted');
  }
};

const clearViolationCounts = () => {
  const now = Date.now();
  const windowStart = now - AUTO_BLACKLIST_WINDOW * 1000;
  Object.keys(violationCounts).forEach((ip) => {
    violationCounts[ip] = violationCounts[ip].filter((ts) => ts > windowStart);
    if (violationCounts[ip].length === 0) {
      delete violationCounts[ip];
    }
  });
};

setInterval(clearViolationCounts, AUTO_BLACKLIST_WINDOW * 1000);

const verifyCortexSignature = (body, signature) => {
  if (!CORTEX_SECRET) {
    return { valid: true, reason: 'No secret configured' };
  }

  if (!signature) {
    return { valid: false, reason: 'Missing signature' };
  }

  try {
    const hmac = crypto.createHmac('sha256', CORTEX_SECRET);
    const digest = hmac.update(JSON.stringify(body)).digest('hex');
    const expectedSignature = `sha256=${digest}`;

    const isValid = crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));

    return { valid: isValid, reason: isValid ? 'OK' : 'Invalid signature' };
  } catch (error) {
    return { valid: false, reason: error.message };
  }
};

const getSecurityConfig = () => {
  return {
    cortexSignature: {
      enabled: !!CORTEX_SECRET,
      hasSecret: CORTEX_SECRET.length > 0
    },
    blacklist: {
      enabled: true,
      count: blacklist.size,
      autoBlacklist: {
        enabled: AUTO_BLACKLIST_THRESHOLD > 0,
        threshold: AUTO_BLACKLIST_THRESHOLD,
        windowSeconds: AUTO_BLACKLIST_WINDOW
      }
    }
  };
};

loadBlacklist();

let logger = null;
const setLogger = (log) => {
  logger = log;
};

module.exports = {
  verifyCortexSignature,
  addToBlacklist,
  removeFromBlacklist,
  isBlacklisted,
  getBlacklist,
  recordViolation,
  getSecurityConfig,
  setLogger,
  get AUTO_BLACKLIST_THRESHOLD() {
    return AUTO_BLACKLIST_THRESHOLD;
  }
};
