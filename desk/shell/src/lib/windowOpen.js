'use strict';
// 链接与弹窗去向（纯函数，供测试）。按"怎么打开的"分类（r5）：
//   R1 脚本弹窗（disposition === 'new-window'，通常由 window.open 带弹窗特征（尺寸等）触发）：
//      壳只做路由，不做过程：不管地址是什么（含 about:blank、空、第三方授权站）→ 'child'，
//      开壳的子窗口，子窗口可以自由导航（授权流程要跳第三方再跳回）。
//   R2 链接新开（disposition 是 'foreground-tab' / 'background-tab' / 'default' / 'other' / 未传）：
//      空链接（空串 / about:blank）或无意义跳向与当前页完全相同的 URL → 'deny'（拦截重复/空子窗口）；
//      严格同源（new URL(url).origin === new URL(serverUrl).origin，防范 user@host 伪造前缀）→ 'child'；
//      其他合法 http: / https: 外站，以及 mailto: / tel: → 'external'（交系统浏览器或邮件/拨号程序）。
//   R3 其他协议或非法 URL（file:、javascript:、data:、ms-settings:、格式错误的 http(s) 等）→ 'deny'：
//      R3 只处理没命中 R1、R2 的情况（R1 先判，所以脚本弹窗不受 R3 限制）。
//      什么都不发生，绝不 shell.openExternal。

function parseOrigin(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return null;
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.origin;
  } catch (_e) {
    return null;
  }
}

function isSameOrigin(url, serverUrl) {
  const targetOrigin = parseOrigin(url);
  const serverOrigin = parseOrigin(serverUrl);
  return targetOrigin !== null && serverOrigin !== null && targetOrigin === serverOrigin;
}

function normalizePageUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return null;
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    // WHATWG URL 对末尾空 "#"（如 <a href="#" target="_blank"> 解析出的 currentUrl + "#"）
    // 会保持 u.hash === '' 但保留 href 末尾的 '#'，这里仅剥离末尾空 '#'，保留真实锚点（如 #sec-2）
    return u.hash === '' ? u.href.replace(/#$/, '') : u.href;
  } catch (_e) {
    return null;
  }
}

function isSamePageUrl(url, currentUrl) {
  const a = normalizePageUrl(url);
  const b = normalizePageUrl(currentUrl);
  return a !== null && b !== null && a === b;
}

function routeWindowOpen(url, serverUrl, disposition, currentUrl) {
  if (disposition === 'new-window') return 'child'; // R1：脚本弹窗一律子窗口
  if (typeof url !== 'string') return 'deny';
  const trimmed = url.trim();
  if (trimmed === '' || trimmed.toLowerCase() === 'about:blank') return 'deny'; // R2：拦截空链接子窗口
  if (/^(mailto|tel):/i.test(trimmed)) return 'external'; // R2（mailto/tel 放行）
  if (/^https?:/i.test(trimmed)) {
    const targetOrigin = parseOrigin(trimmed);
    if (!targetOrigin) return 'deny'; // 非法 http(s) URL 绝不放行
    if (isSameOrigin(trimmed, serverUrl)) {
      if (isSamePageUrl(trimmed, currentUrl)) return 'deny'; // R2：拦截无意义的同页重复子窗口
      return 'child';
    }
    return 'external';
  }
  return 'deny'; // R3
}

module.exports = {
  parseOrigin,
  isSameOrigin,
  isSamePageUrl,
  routeWindowOpen,
};
