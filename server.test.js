const request = require('supertest');

jest.mock('./history', () => ({
  saveRequest: jest.fn(),
  getHistory: jest.fn().mockResolvedValue([]),
  searchHistory: jest.fn().mockResolvedValue([]),
  getStats: jest.fn().mockResolvedValue({ totalRecords: 0, firingAlerts: 0 }),
  closeDb: jest.fn()
}));

jest.mock('./logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  },
  logRequest: jest.fn(),
  logAlert: jest.fn(),
  logBlocked: jest.fn(),
  closeLogger: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('./rateLimiter', () => ({
  checkRateLimit: jest
    .fn()
    .mockResolvedValue({ allowed: true, current: 1, limit: 60, remaining: 59 }),
  getRateLimitStats: jest.fn().mockResolvedValue({ useRedis: false, stats: [] }),
  resetRateLimit: jest.fn().mockResolvedValue(true),
  closeRedis: jest.fn().mockResolvedValue(undefined),
  isUsingRedis: false
}));

jest.mock('./webhookForward', () => ({
  forwardWebhook: jest.fn().mockResolvedValue({ success: false, error: 'Forwarding is disabled' }),
  getForwardConfig: jest.fn().mockReturnValue({ enabled: false, endpoints: [] }),
  testForward: jest.fn().mockResolvedValue({ success: true })
}));

jest.mock('./security', () => ({
  verifyCortexSignature: jest.fn().mockReturnValue({ valid: true, reason: 'OK' }),
  addToBlacklist: jest.fn(),
  removeFromBlacklist: jest.fn(),
  isBlacklisted: jest.fn().mockReturnValue(false),
  getBlacklist: jest.fn().mockReturnValue([]),
  recordViolation: jest.fn(),
  getSecurityConfig: jest
    .fn()
    .mockReturnValue({
      cortexSignature: { enabled: false },
      blacklist: { enabled: true, count: 0 }
    }),
  setLogger: jest.fn()
}));

const app = require('./server');

describe('Webhook Server', () => {
  describe('GET /health', () => {
    it('should return ok status', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ok' });
    });

    it('should include X-Request-ID header', async () => {
      const res = await request(app).get('/health');
      expect(res.headers['x-request-id']).toBeDefined();
    });
  });

  describe('POST /test', () => {
    it('should return ok with received message', async () => {
      const res = await request(app)
        .post('/test')
        .send({ status: 'firing', alerts: [{ title: 'Test Alert', state: 'firing' }] });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ok', message: 'received', forwarded: 0 });
    });

    it('should include X-Request-ID header', async () => {
      const res = await request(app)
        .post('/test')
        .send({ status: 'firing', alerts: [{ title: 'Test Alert' }] });
      expect(res.headers['x-request-id']).toBeDefined();
    });
  });

  describe('404', () => {
    it('should return 404 for unknown routes', async () => {
      const res = await request(app).get('/unknown');
      expect(res.status).toBe(404);
    });
  });
});
