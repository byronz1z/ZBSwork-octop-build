'use strict';
const fs = require('fs');
const path = require('path');

const SENSITIVE_KEY_RE = /token|secret|password|passwd|auth|cookie|apikey|api_key|credential|session/i;
const SENSITIVE_VALUE_RE = /(bearer\s+\S+|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/i;

// 脱敏 URL：剥离用户名密码、query 与 hash（绝不落盘 token/code/密码）
function sanitizeLogUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl) return '';
  try {
    const u = new URL(rawUrl);
    if (u.protocol === 'http:' || u.protocol === 'https:') {
      return u.origin + u.pathname;
    }
    if (u.protocol === 'file:') {
      const base = path.posix.basename(u.pathname || '') || 'file';
      return 'file:///' + base;
    }
    return u.protocol + '//[redacted]';
  } catch (_e) {
    return rawUrl.split(/[?#]/)[0].slice(0, 200);
  }
}

function sanitizeLogData(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (depth > 4) return '[depth-limit]';
  if (typeof value === 'string') {
    if (SENSITIVE_VALUE_RE.test(value)) return '[REDACTED]';
    return value.length > 300 ? value.slice(0, 300) + '…' : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeLogData(item, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SENSITIVE_KEY_RE.test(k)) {
        out[k] = '[REDACTED]';
      } else if (/url$/i.test(k) && typeof v === 'string') {
        out[k] = sanitizeLogUrl(v);
      } else {
        out[k] = sanitizeLogData(v, depth + 1);
      }
    }
    return out;
  }
  return String(value);
}

// 轻量本地故障日志：写至 userData/logs/main.log，超限时截断头部保留最新日志；永不抛异常影响主进程
function createFaultLogger(logFilePath, options = {}) {
  const maxBytes = options.maxBytes || 256 * 1024;
  const keepBytes = Math.min(options.keepBytes || Math.floor(maxBytes / 2), maxBytes);

  function truncateIfNeeded() {
    const stat = fs.statSync(logFilePath);
    if (stat.size <= maxBytes) return;
    const buf = fs.readFileSync(logFilePath);
    let sliced = buf.subarray(Math.max(0, buf.length - keepBytes));
    const nl = sliced.indexOf(0x0a);
    if (nl !== -1 && nl + 1 < sliced.length) {
      sliced = sliced.subarray(nl + 1);
    }
    fs.writeFileSync(logFilePath, sliced);
  }

  function log(event, details) {
    try {
      fs.mkdirSync(path.dirname(logFilePath), { recursive: true });
      const ts = new Date().toISOString();
      const payload = details && Object.keys(details).length > 0
        ? ' ' + JSON.stringify(sanitizeLogData(details))
        : '';
      const line = `${ts} [${String(event)}]${payload}\n`;
      fs.appendFileSync(logFilePath, line, 'utf8');
      truncateIfNeeded();
    } catch (_e) {
      // 日志写失败绝不阻塞或崩溃主进程
    }
  }

  return { log, filePath: logFilePath };
}

module.exports = {
  sanitizeLogUrl,
  sanitizeLogData,
  createFaultLogger,
};
