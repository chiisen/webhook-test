const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = process.env.DB_PATH || './webhook-history.db';
const HISTORY_DAYS = parseInt(process.env.HISTORY_DAYS || '30', 10);
const HISTORY_MAX_SIZE_MB = parseInt(process.env.HISTORY_MAX_SIZE_MB || '100', 10);

let dbReady = false;

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Failed to connect to SQLite database:', err);
    process.exit(1); // 或者實現重試邏輯
  } else {
    console.log(`SQLite database connected: ${DB_PATH}`);
    initTable();
    dbReady = true;
  }
});

const initTable = () => {
  return new Promise((resolve, reject) => {
    db.run(`
      CREATE TABLE IF NOT EXISTS requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        request_id TEXT NOT NULL,
        method TEXT NOT NULL,
        url TEXT NOT NULL,
        ip TEXT,
        status INTEGER,
        payload TEXT
      )
    `, (err) => {
      if (err) return reject(err);
      db.run('CREATE INDEX IF NOT EXISTS idx_timestamp ON requests(timestamp)', (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  });
};

const cleanupOldRecords = () => {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - HISTORY_DAYS);
  const cutoffStr = cutoffDate.toISOString();

  db.run('DELETE FROM requests WHERE timestamp < ?', [cutoffStr], (err) => {
    if (err) {
      console.error('Failed to cleanup old records:', err);
    } else {
      console.log(`Cleaned up records older than ${HISTORY_DAYS} days`);
    }
  });
};

const enforceSizeLimit = () => {
  const maxBytes = HISTORY_MAX_SIZE_MB * 1024 * 1024;

  db.get(
    'SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()',
    (err, row) => {
      if (err || !row) return;

      if (row.size > maxBytes) {
        const deleteCount = Math.ceil((row.size - maxBytes) * 0.2);
        db.run(
          `DELETE FROM requests WHERE id IN (SELECT id FROM requests ORDER BY timestamp ASC LIMIT ?)`,
          [deleteCount],
          (err) => {
            if (err) {
              console.error('Failed to enforce size limit:', err);
            } else {
              console.log(`Enforced size limit: deleted ~${deleteCount} oldest records`);
            }
          }
        );
      }
    }
  );
};

setInterval(
  () => {
    cleanupOldRecords();
    enforceSizeLimit();
  },
  60 * 60 * 1000
);

cleanupOldRecords();
enforceSizeLimit();

const saveRequest = (req, res, payload) => {
  const record = {
    timestamp: new Date().toISOString(),
    requestId: req.id || 'N/A',
    method: req.method,
    url: req.url,
    ip: req.ip || (req.headers && req.headers['x-forwarded-for']) || req.socket.remoteAddress,
    status: res.statusCode,
    payload: JSON.stringify(payload)
  };

  const stmt = db.prepare(`
    INSERT INTO requests (timestamp, request_id, method, url, ip, status, payload)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    record.timestamp,
    record.requestId,
    record.method,
    record.url,
    record.ip,
    record.status,
    record.payload,
    (err) => {
      if (err) {
        console.error('Failed to save request:', err);
      }
      stmt.finalize();
    }
  );
};

const getHistory = (limit = 100) => {
  return new Promise((resolve, reject) => {
    const stmt = db.prepare(`
      SELECT * FROM (
        SELECT * FROM requests ORDER BY timestamp DESC LIMIT ?
      ) ORDER BY timestamp ASC
    `);

    const results = [];
    stmt.each(
      (err, row) => {
        if (err) {
          reject(err);
          return;
        }
        if (row.payload) {
          row.payload = JSON.parse(row.payload);
        }
        results.push(row);
      },
      (err) => {
        stmt.finalize();
        if (err) {
          reject(err);
        } else {
          resolve(results.reverse());
        }
      }
    );
  });
};

const searchHistory = (filters = {}) => {
  return new Promise((resolve, reject) => {
    let sql = 'SELECT * FROM requests WHERE 1=1';
    const params = [];

    if (filters.status) {
      sql += ' AND status = ?';
      params.push(filters.status);
    }
    if (filters.ip) {
      sql += ' AND ip LIKE ?';
      params.push(`%${filters.ip}%`);
    }

    sql += ' ORDER BY timestamp DESC LIMIT 100';

    db.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      const results = rows.map(row => {
        if (row && row.payload) {
          try {
            row.payload = JSON.parse(row.payload);
          } catch (e) {
            console.error('Failed to parse payload:', e);
          }
        }
        return row;
      });
      resolve(results);
    });
  });
};

const getStats = () => {
  return new Promise((resolve, reject) => {
    db.get('SELECT COUNT(*) as total FROM requests', (err, totalRow) => {
      if (err) {
        reject(err);
        return;
      }
      db.get(
        'SELECT COUNT(*) as firing FROM requests WHERE payload LIKE ?',
        ['%"status":"firing"%'],
        (err, firingRow) => {
          if (err) {
            reject(err);
          } else {
            resolve({
              totalRecords: totalRow?.total || 0,
              firingAlerts: firingRow?.firing || 0
            });
          }
        }
      );
    });
  });
};

const closeDb = () => {
  db.close((err) => {
    if (err) {
      console.error('Failed to close database:', err);
    } else {
      console.log('Database connection closed');
    }
  });
};

module.exports = { saveRequest, getHistory, searchHistory, getStats, closeDb };
