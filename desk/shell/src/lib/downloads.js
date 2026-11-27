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

// 统一路径比较键：斜杠归一，Windows 大小写不敏感
function normalizePathKey(p, platform) {
  const unified = String(p || '').replace(/\\/g, '/').replace(/\/+/g, '/');
  return platform === 'win32' ? unified.toLowerCase() : unified;
}

// 并发同名下载防覆盖：选出不与磁盘已有文件及进行中下载冲突的保存路径，并立即记入内存预留集合。
// 返回 { savePath, release }，下载完成/取消/中断时调用 release() 释放内存预留。
function reserveDownloadPath(dir, filename, reservedSet, existsFn, platform) {
  const isTaken = (candidate) => {
    const key = normalizePathKey(candidate, platform);
    return reservedSet.has(key) || existsFn(candidate);
  };
  const savePath = uniqueDownloadPath(dir, filename, isTaken);
  const key = normalizePathKey(savePath, platform);
  reservedSet.add(key);
  const release = () => {
    reservedSet.delete(key);
  };
  return { savePath, release };
}

// 下载完成/失败后窗口内提示条的文案（纯函数，供测试与主进程共用）。
// state === 'completed' 算成功；state === 'cancelled'（用户主动取消）返回 null（不弹提示）；
// filename 为空时兜底为"文件"。
function downloadToast(state, filename) {
  if (state === 'cancelled') return null;
  const name = filename || '文件';
  if (state === 'completed') return { ok: true, text: '已保存到下载文件夹：' + name };
  return { ok: false, text: '下载失败：' + name };
}

module.exports = {
  uniqueDownloadPath,
  normalizePathKey,
  reserveDownloadPath,
  downloadToast,
};
