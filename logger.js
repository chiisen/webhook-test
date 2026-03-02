const pino = require('pino');
const fs = require('fs');
const path = require('path');

const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const LOG_DIR = process.env.LOG_DIR || './logs';
const LOG_MAX_FILES = parseInt(process.env.LOG_MAX_FILES || '7', 10);
const LOG_MAX_SIZE = process.env.LOG_MAX_SIZE || '100m';
const ENABLE_CONSOLE_LOG = process.env.ENABLE_CONSOLE_LOG !== 'false';
const ENABLE_FILE_LOG = process.env.ENABLE_FILE_LOG !== 'false';

if (ENABLE_FILE_LOG && !fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

const pinoOptions = {
  level: LOG_LEVEL,
  formatters: {
    level: (label) => {
      return { level: label };
    }
  },
  timestamp: () => `,"timestamp":"${new Date().toISOString()}"`
};

let loggerInstance = null;
let loggerReady = false;

const initLogger = () => {
  if (loggerReady) return loggerInstance;

  try {
    if (ENABLE_FILE_LOG) {
      const logFile = path.join(LOG_DIR, 'webhook.log');

      loggerInstance = pino(
        pinoOptions,
        pino.transport({
          targets: [
            ...(ENABLE_CONSOLE_LOG
              ? [
                  {
                    target: 'pino-pretty',
                    options: {
                      colorize: true,
                      translateTime: 'SYS:standard',
                      ignore: 'pid,hostname'
                    }
                  }
                ]
              : []),
            {
              target: 'pino/file',
              options: { destination: logFile }
            }
          ]
        })
      );
    } else {
      loggerInstance = pino(pinoOptions);
    }
    loggerReady = true;
  } catch (error) {
    console.error('Logger initialization failed:', error);
    loggerInstance = pino(pinoOptions);
    loggerReady = true;
  }

  return loggerInstance;
};

const logger = {
  get info() {
    return initLogger().info;
  },
  get warn() {
    return initLogger().warn;
  },
  get error() {
    return initLogger().error;
  },
  get debug() {
    return initLogger().debug;
  },
  get child() {
    return initLogger().child;
  },
  get flush() {
    return initLogger().flush;
  },
  get destroy() {
    return initLogger().destroy;
  }
};

const logRequest = (req, res, duration) => {
  logger.info({
    type: 'request',
    method: req.method,
    url: req.url,
    status: res.statusCode,
    ip: req.ip || req.connection?.remoteAddress,
    requestId: req.id,
    duration
  });
};

const logAlert = (status, alertsCount, filteredCount) => {
  logger.info({
    type: 'alert',
    status,
    alertsCount,
    filteredCount
  });
};

const logBlocked = (type, ip, reason) => {
  logger.warn({
    type: 'blocked',
    blockType: type,
    ip,
    reason
  });
};

const closeLogger = async () => {
  if (!logger) return;

  try {
    if (typeof logger.flush === 'function') {
      await new Promise((resolve) => {
        logger.flush(() => {
          if (typeof logger.destroy === 'function') {
            logger.destroy();
          }
          resolve();
        });
      });
    }
  } catch (error) {
    console.warn('Logger cleanup warning:', error.message);
  }
};

process.on('exit', () => {
  if (!loggerReady) return;
  console.warn('⚠️  Process exiting - please use graceful shutdown to avoid resource leaks');
});

process.on('warning', (warning) => {
  if (warning.name === 'MaxListenersExceededWarning') {
    console.warn('⚠️  Memory leak warning:', warning.message);
  }
});

module.exports = { logger: initLogger(), logRequest, logAlert, logBlocked, closeLogger };
