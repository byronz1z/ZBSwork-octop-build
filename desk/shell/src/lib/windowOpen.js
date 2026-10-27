'use strict';
// window.open 路由（纯函数，供测试）：URL 以 serverUrl 为前缀→子窗口，其他→系统浏览器。
function routeWindowOpen(url, serverUrl) {
  return url.startsWith(serverUrl) ? 'child' : 'external';
}

module.exports = { routeWindowOpen };
