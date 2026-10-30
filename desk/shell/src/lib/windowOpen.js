'use strict';
// 链接与弹窗去向（纯函数，供测试）。按"怎么打开的"分类：
//   R1 脚本弹窗（disposition === 'new-window'，通常由 window.open 带弹窗特征（尺寸等）触发）：
//      不管地址是什么（含 about:blank、空、第三方授权站）→ 'child'，
//      开壳的子窗口，子窗口可以自由导航（授权流程要跳第三方再跳回）。
//   R2 链接新开（disposition 是 'foreground-tab' / 'background-tab' / 'default' / 'other' / 未传）：
//      地址以 serverUrl 为前缀（现有逻辑，保留 startsWith）→ 'child'（壳没有标签页，用子窗口代替浏览器的新标签）；
//      地址是 http: / https: 的外站，以及 mailto: / tel: → 'external'（交系统浏览器或邮件/拨号程序；mailto/tel 是 r4 放行）；
//      地址是 about:blank 或空串 → 'child'。
//   R3 其他协议（file:、javascript:、data:、ms-settings: 等任何不是 http/https/mailto/tel/about 的）→ 'deny'：
//      R3 只处理没命中 R1、R2 的情况（R1 先判，所以脚本弹窗不受 R3 限制）。
//      什么都不发生，绝不 shell.openExternal。
function routeWindowOpen(url, serverUrl, disposition) {
  if (disposition === 'new-window') return 'child'; // R1
  if (url.startsWith(serverUrl)) return 'child'; // R2
  if (/^(https?|mailto|tel):/i.test(url)) return 'external'; // R2（mailto/tel 为 r4 放行）
  if (url === 'about:blank' || url === '') return 'child'; // R2
  return 'deny'; // R3
}

module.exports = { routeWindowOpen };
