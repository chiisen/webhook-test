const axios = require('axios');
const { exec } = require('child_process');
const { spawn } = require('child_process');

const TELEGRAM_ENABLED = process.env.TELEGRAM_ENABLED === 'true';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

const DISCORD_ENABLED = process.env.DISCORD_ENABLED === 'true';
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || '';

const CUSTOM_SCRIPT_ENABLED = process.env.CUSTOM_SCRIPT_ENABLED === 'true';
const CUSTOM_SCRIPT_PATH = process.env.CUSTOM_SCRIPT_PATH || '';
const CUSTOM_SCRIPT_TIMEOUT = parseInt(process.env.CUSTOM_SCRIPT_TIMEOUT || '30000', 10);

const NOTIFICATION_ON_FIRING = process.env.NOTIFICATION_ON_FIRING !== 'false';
const NOTIFICATION_ON_RESOLVED = process.env.NOTIFICATION_ON_RESOLVED === 'true';

const formatTelegramMessage = (payload) => {
  const { status, alerts, commonLabels, commonAnnotations } = payload;
  const emoji = status === 'firing' ? '🔴' : '🟢';

  let message = `${emoji} *Grafana Alert*\\n`;
  message += `*Status:* ${status.toUpperCase()}\\n`;

  if (commonLabels) {
    message += `\\n*Labels:*\\n`;
    Object.entries(commonLabels).forEach(([key, value]) => {
      message += `• ${key}: ${value}\\n`;
    });
  }

  if (alerts && alerts.length > 0) {
    message += `\\n*Alerts (${alerts.length}):*\\n`;
    alerts.slice(0, 5).forEach((alert) => {
      message += `• ${alert.title || alert.labels?.alertname || 'Unknown'}`;
      if (alert.state) message += ` [${alert.state}]`;
      message += '\\n';
    });
    if (alerts.length > 5) {
      message += `... and ${alerts.length - 5} more\\n`;
    }
  }

  return message;
};

const sendTelegramNotification = async (payload) => {
  if (!TELEGRAM_ENABLED || !TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    return { success: false, reason: 'Telegram not configured' };
  }

  try {
    const message = formatTelegramMessage(payload);
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

    const response = await axios.post(
      url,
      {
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'MarkdownV2'
      },
      { timeout: 10000 }
    );

    return { success: true, messageId: response.data.result.message_id };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

const formatDiscordEmbed = (payload) => {
  const { status, alerts, commonLabels, commonAnnotations } = payload;
  const color = status === 'firing' ? 16711680 : 65280;

  const embed = {
    embeds: [
      {
        title: `Grafana Alert - ${status.toUpperCase()}`,
        color: color,
        timestamp: new Date().toISOString(),
        fields: []
      }
    ]
  };

  if (commonLabels) {
    embed.embeds[0].fields.push({
      name: 'Labels',
      value:
        Object.entries(commonLabels)
          .map(([k, v]) => `${k}: ${v}`)
          .join('\n') || 'N/A',
      inline: false
    });
  }

  if (alerts && alerts.length > 0) {
    const alertText = alerts
      .slice(0, 10)
      .map((alert) => {
        const title = alert.title || alert.labels?.alertname || 'Unknown';
        const state = alert.state || '';
        return `**${title}**${state ? ` [${state}]` : ''}`;
      })
      .join('\n');

    embed.embeds[0].fields.push({
      name: `Alerts (${alerts.length})`,
      value: alertText,
      inline: false
    });
  }

  return embed;
};

const sendDiscordNotification = async (payload) => {
  if (!DISCORD_ENABLED || !DISCORD_WEBHOOK_URL) {
    return { success: false, reason: 'Discord not configured' };
  }

  try {
    const embed = formatDiscordEmbed(payload);
    const response = await axios.post(DISCORD_WEBHOOK_URL, embed, {
      timeout: 10000,
      headers: { 'Content-Type': 'application/json' }
    });

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

const runCustomScript = (payload) => {
  if (!CUSTOM_SCRIPT_ENABLED || !CUSTOM_SCRIPT_PATH) {
    return { success: false, reason: 'Custom script not configured' };
  }

  return new Promise((resolve) => {
    const startTime = Date.now();

    const child = spawn(CUSTOM_SCRIPT_PATH, [], {
      shell: true,
      env: { ...process.env, WEBHOOK_PAYLOAD: JSON.stringify(payload) }
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      resolve({ success: false, error: 'Script timeout', duration: Date.now() - startTime });
    }, CUSTOM_SCRIPT_TIMEOUT);

    child.on('close', (code) => {
      clearTimeout(timeout);
      resolve({
        success: code === 0,
        exitCode: code,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        duration: Date.now() - startTime
      });
    });

    child.on('error', (error) => {
      clearTimeout(timeout);
      resolve({ success: false, error: error.message, duration: Date.now() - startTime });
    });
  });
};

const sendNotification = async (payload) => {
  const { status } = payload;
  const results = {};

  if (status === 'firing' && !NOTIFICATION_ON_FIRING) {
    return { success: false, reason: 'Notifications for firing disabled' };
  }

  if (status === 'resolved' && !NOTIFICATION_ON_RESOLVED) {
    return { success: false, reason: 'Notifications for resolved disabled' };
  }

  const promises = [];

  if (TELEGRAM_ENABLED) {
    promises.push(
      sendTelegramNotification(payload).then((r) => {
        results.telegram = r;
      })
    );
  }

  if (DISCORD_ENABLED) {
    promises.push(
      sendDiscordNotification(payload).then((r) => {
        results.discord = r;
      })
    );
  }

  if (CUSTOM_SCRIPT_ENABLED) {
    promises.push(
      runCustomScript(payload).then((r) => {
        results.customScript = r;
      })
    );
  }

  await Promise.all(promises);

  const allSuccess = Object.values(results).every((r) => r.success || r.reason);

  return {
    success: allSuccess,
    results
  };
};

const testNotification = async (type) => {
  const testPayload = {
    status: 'firing',
    alerts: [{ title: 'Test Alert', state: 'firing', labels: { alertname: 'Test' } }],
    commonLabels: { environment: 'test' }
  };

  switch (type) {
    case 'telegram':
      return sendTelegramNotification(testPayload);
    case 'discord':
      return sendDiscordNotification(testPayload);
    case 'script':
      return runCustomScript(testPayload);
    default:
      return { success: false, error: 'Unknown notification type' };
  }
};

const getNotificationConfig = () => {
  return {
    telegram: {
      enabled: TELEGRAM_ENABLED,
      configured: !!(TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID)
    },
    discord: {
      enabled: DISCORD_ENABLED,
      configured: !!DISCORD_WEBHOOK_URL
    },
    customScript: {
      enabled: CUSTOM_SCRIPT_ENABLED,
      configured: !!CUSTOM_SCRIPT_PATH,
      path: CUSTOM_SCRIPT_PATH,
      timeout: CUSTOM_SCRIPT_TIMEOUT
    },
    triggers: {
      onFiring: NOTIFICATION_ON_FIRING,
      onResolved: NOTIFICATION_ON_RESOLVED
    }
  };
};

module.exports = {
  sendNotification,
  testNotification,
  getNotificationConfig,
  sendTelegramNotification,
  sendDiscordNotification,
  runCustomScript
};
