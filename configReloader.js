const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const ENV_FILE = process.env.ENV_FILE || '.env';
const RELOAD_INTERVAL = parseInt(process.env.RELOAD_INTERVAL || '5000', 10);

let lastModified = 0;
let configCache = {};
let listeners = [];

const parseEnvFile = (filePath) => {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const result = {};
    content.split('\n').forEach((line) => {
      line = line.trim();
      if (!line || line.startsWith('#')) return;
      const [key, ...valueParts] = line.split('=');
      if (key) {
        result[key.trim()] = valueParts.join('=').trim();
      }
    });
    return result;
  } catch (error) {
    return null;
  }
};

const loadConfig = () => {
  const filePath = path.resolve(ENV_FILE);

  if (!fs.existsSync(filePath)) {
    console.warn(`Config file not found: ${filePath}`);
    return false;
  }

  const stats = fs.statSync(filePath);
  const modified = stats.mtimeMs;

  if (modified === lastModified) {
    return false;
  }

  const newConfig = parseEnvFile(filePath);
  if (!newConfig) {
    return false;
  }

  const oldConfig = { ...configCache };
  configCache = newConfig;
  lastModified = modified;

  const changes = {};
  Object.keys(newConfig).forEach((key) => {
    if (oldConfig[key] !== newConfig[key]) {
      changes[key] = { old: oldConfig[key], new: newConfig[key] };
    }
  });

  if (Object.keys(changes).length > 0) {
    console.log(`🔄 Config reloaded: ${Object.keys(changes).length} changes detected`);
    listeners.forEach((listener) => listener(changes, newConfig));
    return true;
  }

  return false;
};

const watchConfig = () => {
  loadConfig();

  const watcher = fs.watch(ENV_FILE, (eventType) => {
    if (eventType === 'change') {
      setTimeout(loadConfig, 100);
    }
  });

  console.log(`📂 Watching config file: ${ENV_FILE}`);

  return watcher;
};

const startReloader = (interval = RELOAD_INTERVAL) => {
  setInterval(loadConfig, interval);
};

const onConfigChange = (listener) => {
  listeners.push(listener);
};

const getConfig = (key) => {
  if (Object.keys(configCache).length === 0) {
    loadConfig();
  }
  return configCache[key];
};

const getAllConfig = () => {
  if (Object.keys(configCache).length === 0) {
    loadConfig();
  }
  return { ...configCache };
};

const reloadConfig = () => {
  return loadConfig();
};

module.exports = {
  watchConfig,
  startReloader,
  onConfigChange,
  getConfig,
  getAllConfig,
  reloadConfig
};
