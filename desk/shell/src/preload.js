'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// contextIsolation 开着，页面拿不到 ipcRenderer 本体，只暴露这两组
contextBridge.exposeInMainWorld('zbswork', {
  retry: () => ipcRenderer.send('zbswork:retry'),
});

// 桌面壳标识 + 点系统通知时把窗口叫到前面（补丁 24 网页端会调）
contextBridge.exposeInMainWorld('zbsDesktop', {
  isDesktop: true,
  focusWindow: () => ipcRenderer.send('zbs:focus-window'),
});

// ---- 下载提示条（toast）：主进程下载 done 后发 zbs:download-done，这里在页面 DOM 里渲染 ----
// preload 和页面共用同一个 DOM（contextIsolation 只隔离 JS 变量，不隔离 document），
// 所以可以直接操作 document；样式全写在元素 style 属性上，不插 <style>，避免和网页样式冲突。
// 不往 window 上暴露任何新接口（zbswork / zbsDesktop 维持原样）。
function showDownloadToast(info) {
  const mount = () => {
    let box = document.getElementById('zbs-download-toasts');
    if (!box) {
      box = document.createElement('div');
      box.id = 'zbs-download-toasts';
      const s = box.style;
      s.position = 'fixed'; s.right = '16px'; s.bottom = '16px';
      s.zIndex = '2147483647'; s.display = 'flex'; s.flexDirection = 'column';
      s.gap = '8px'; s.font = "14px/1.4 system-ui, 'Microsoft YaHei', sans-serif";
      document.body.appendChild(box);
    }
    const toast = document.createElement('div');
    toast.className = 'zbs-download-toast';
    const ts = toast.style;
    ts.background = info.ok ? '#1f1f1f' : '#a8071a';
    ts.color = '#fff'; ts.borderRadius = '8px'; ts.padding = '10px 14px';
    ts.boxShadow = '0 4px 16px rgba(0,0,0,.35)'; ts.display = 'flex';
    ts.alignItems = 'center'; ts.gap = '12px'; ts.maxWidth = '420px';

    const text = document.createElement('span');
    text.textContent = info.text; // 不用 innerHTML：文件名来自网页，防注入
    text.style.flex = '1';
    toast.appendChild(text);

    if (info.ok && info.savePath) {
      const open = document.createElement('button');
      open.textContent = '打开文件夹';
      const os2 = open.style;
      os2.background = '#fff'; os2.color = '#1f1f1f'; os2.border = '0';
      os2.borderRadius = '6px'; os2.padding = '4px 10px'; os2.cursor = 'pointer';
      open.addEventListener('click', () => {
        ipcRenderer.send('zbs:open-download', info.savePath);
        toast.remove();
      });
      toast.appendChild(open);
    }

    const close = document.createElement('button');
    close.textContent = '×';
    const cs = close.style;
    cs.background = 'transparent'; cs.color = '#fff'; cs.border = '0';
    cs.cursor = 'pointer'; cs.fontSize = '16px';
    close.addEventListener('click', () => toast.remove());
    toast.appendChild(close);

    // 8 秒自动消失；悬停暂停（清定时器），移开重新计 8 秒
    let timer = null;
    const armTimer = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => toast.remove(), 8000);
    };
    toast.addEventListener('mouseenter', () => { if (timer) clearTimeout(timer); });
    toast.addEventListener('mouseleave', armTimer);
    armTimer();

    box.appendChild(toast);
  };
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', () => mount());
}

ipcRenderer.on('zbs:download-done', (_e, info) => showDownloadToast(info));
