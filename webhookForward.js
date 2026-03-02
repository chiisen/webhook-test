const axios = require('axios');

const FORWARD_ENDPOINTS = process.env.FORWARD_ENDPOINTS || '';
const FORWARD_TIMEOUT = parseInt(process.env.FORWARD_TIMEOUT || '5000', 10);
const FORWARD_ENABLED = process.env.FORWARD_ENABLED === 'true';
const FORWARD_AUTH_HEADER = process.env.FORWARD_AUTH_HEADER || '';

const endpoints = FORWARD_ENDPOINTS
  ? FORWARD_ENDPOINTS.split(',')
      .map((url) => url.trim())
      .filter(Boolean)
  : [];

const forwardWebhook = async (payload, options = {}) => {
  const targets = options.targets || endpoints;

  if (!FORWARD_ENABLED && !options.force) {
    return { success: false, error: 'Forwarding is disabled' };
  }

  if (targets.length === 0) {
    return { success: false, error: 'No forward endpoints configured' };
  }

  const results = await Promise.allSettled(
    targets.map(async (url) => {
      try {
        const headers = {
          'Content-Type': 'application/json',
          'X-Forwarded-By': 'webhook-server',
          ...(FORWARD_AUTH_HEADER && { Authorization: FORWARD_AUTH_HEADER }),
          ...(options.headers || {})
        };

        const response = await axios.post(url, payload, {
          headers,
          timeout: options.timeout || FORWARD_TIMEOUT,
          validateStatus: () => true
        });

        return {
          url,
          success: response.status >= 200 && response.status < 300,
          status: response.status,
          data: response.data
        };
      } catch (error) {
        return {
          url,
          success: false,
          error: error.message
        };
      }
    })
  );

  const forwarded = results.map((r) => r.value || r.reason.value);
  const allSuccess = forwarded.every((r) => r.success);

  return {
    success: allSuccess,
    total: targets.length,
    results: forwarded
  };
};

const getForwardConfig = () => {
  return {
    enabled: FORWARD_ENABLED,
    endpoints: endpoints.map((url) => ({ url })),
    timeout: FORWARD_TIMEOUT,
    hasAuth: !!FORWARD_AUTH_HEADER
  };
};

const testForward = async (url, payload = { test: true }) => {
  try {
    const response = await axios.post(url, payload, {
      timeout: FORWARD_TIMEOUT,
      validateStatus: () => true
    });

    return {
      success: response.status >= 200 && response.status < 300,
      status: response.status,
      data: response.data
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
};

module.exports = {
  forwardWebhook,
  getForwardConfig,
  testForward,
  get endpoints() {
    return endpoints;
  }
};
