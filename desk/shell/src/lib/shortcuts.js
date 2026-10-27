'use strict';
// 快捷键映射（纯函数，供测试）。darwin 上 Cmd（input.meta）代 Ctrl（input.control）。
function mapShortcut(input, platform) {
  if (input.type && input.type !== 'keyDown') return null;
  const darwin = platform === 'darwin';
  const mod = darwin ? !!input.meta : !!input.control;
  const key = input.key;

  if (key === 'F5' || (mod && (key === 'r' || key === 'R'))) return 'reload';
  if (mod && (key === '=' || key === '+')) return 'zoomIn';
  if (mod && key === '-') return 'zoomOut';
  if (mod && key === '0') return 'zoomReset';
  if (key === 'F11' || (darwin && input.control && input.meta && (key === 'f' || key === 'F'))) {
    return 'fullscreen';
  }
  if ((input.alt && key === 'Left') || (darwin && input.meta && !input.control && key === '[')) return 'back';
  if (mod && (key === 'f' || key === 'F') && !input.alt && !input.shift) return 'find';
  if (key === 'Escape') return 'escape';
  return null;
}

module.exports = { mapShortcut };
