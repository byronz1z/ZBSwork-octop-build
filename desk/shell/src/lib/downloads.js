'use strict';
// 下载重名避让（纯函数，供测试）：同名不覆盖，按 "名 (1).扩展名" 递增。
// 分隔符固定为 / 再交给调用方（win32 的 path.join 会出 \，测试跨平台不好写）。
// existsFn(p) 返回路径是否已存在。
function uniqueDownloadPath(dir, filename, existsFn) {
  const dot = filename.lastIndexOf('.');
  const hasExt = dot > 0;
  const base = hasExt ? filename.slice(0, dot) : filename;
  const ext = hasExt ? filename.slice(dot) : '';
  const join = (name) => (dir.endsWith('/') || dir.endsWith('\\') ? dir + name : dir + '/' + name);
  let candidate = join(filename);
  let n = 1;
  while (existsFn(candidate)) {
    candidate = join(`${base} (${n})${ext}`);
    n += 1;
  }
  return candidate;
}

module.exports = { uniqueDownloadPath };
