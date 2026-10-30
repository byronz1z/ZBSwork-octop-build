'use strict';
// 链接与弹窗去向（纯函数，供测试）。按"怎么打开的"分类：
//   R1 脚本弹窗（disposition === 'new-window'，即 window.open 带窗口尺寸参数）：
//      不管地址是什么（含 about:blank、空、第三方授权站）→ 'child'，
//      开壳的子窗口，子窗口可以自由导航（授权流程要跳第三方再跳回）。
//   R2 链接新开（disposition 是 'foreground-tab' / 'background-tab' / 'default' / 'other' / 未传）：
//      地址以 serverUrl 为前缀（现有逻辑，保留 startsWith）→ 'child'（壳没有标签页，用子窗口代替浏览器的新标签）；
//      地址是 http: 或 https: 的外站 → 'external'（交系统浏览器）；
//      地址是 about:blank 或空串 → 'child'。
//   R3 其他协议（file:、javascript:、data:、ms-settings: 等任何不是 http/https 的）→ 'deny'：
//      什么都不发生，绝不 shell.openExternal。
function routeWindowOpen(url, serverUrl, disposition) {
  if (disposition === 'new-window') return 'child'; // R1
  if (url.startsWith(serverUrl)) return 'child'; // R2
  if (/^https?:/i.test(url)) return 'external'; // R2
  if (url === 'about:blank' || url === '') return 'child'; // R2
  return 'deny'; // R3
}

module.exports = { routeWindowOpen };
