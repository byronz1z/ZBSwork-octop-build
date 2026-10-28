'use strict';
// 窗口记忆（纯函数，供测试）：把记忆里的窗口坐标夹进当前屏幕工作区。
// bounds: {x,y,width,height}；displays: [{workArea:{x,y,width,height}}]；defaults: {width,height}
function clampBounds(bounds, displays, defaults) {
  const fits = (b, wa) =>
    b.x >= wa.x && b.y >= wa.y &&
    b.x + b.width <= wa.x + wa.width &&
    b.y + b.height <= wa.y + wa.height;
  if (displays.some((d) => fits(bounds, d.workArea))) return { ...bounds };

  // 找重叠面积最大的屏幕
  let best = null;
  let bestArea = 0;
  for (const d of displays) {
    const wa = d.workArea;
    const ox = Math.max(0, Math.min(bounds.x + bounds.width, wa.x + wa.width) - Math.max(bounds.x, wa.x));
    const oy = Math.max(0, Math.min(bounds.y + bounds.height, wa.y + wa.height) - Math.max(bounds.y, wa.y));
    const area = ox * oy;
    if (area > bestArea) { bestArea = area; best = wa; }
  }
  if (!best) {
    // 完全在屏幕外：默认大小（先夹到不超过工作区）在首个屏幕工作区居中
    const wa = displays[0].workArea;
    const width = Math.min(defaults.width, wa.width);
    const height = Math.min(defaults.height, wa.height);
    return {
      x: wa.x + Math.round((wa.width - width) / 2),
      y: wa.y + Math.round((wa.height - height) / 2),
      width,
      height,
    };
  }
  // 部分在外：大小不变，平移进该屏幕
  const width = Math.min(bounds.width, best.width);
  const height = Math.min(bounds.height, best.height);
  return {
    x: Math.min(Math.max(bounds.x, best.x), best.x + best.width - width),
    y: Math.min(Math.max(bounds.y, best.y), best.y + best.height - height),
    width,
    height,
  };
}

module.exports = { clampBounds };
