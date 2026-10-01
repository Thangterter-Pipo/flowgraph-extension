import React, { useEffect, useState } from 'react';
import { DEVELOPER_MODE_KEY } from '../../shared/devDiagnostics';

export function DeveloperModeToggle() {
  const [enabled, setEnabled] = useState(false);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState('');
  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
    let alive = true;
    let changed = false;
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (alive && area === 'local' && DEVELOPER_MODE_KEY in changes) {
        changed = true;
        setEnabled(changes[DEVELOPER_MODE_KEY].newValue === true);
      }
    };
    chrome.storage.onChanged.addListener(listener);
    void chrome.storage.local.get(DEVELOPER_MODE_KEY).then((data) => {
      if (alive) { if (!changed) setEnabled(data[DEVELOPER_MODE_KEY] === true); setReady(true); }
    }).catch(() => { if (alive) setStatus('Không đọc được tùy chọn developer mode.'); });
    return () => { alive = false; chrome.storage.onChanged.removeListener(listener); };
  }, []);
  return <div className="checkbox-row">
    <label className="checkbox-label">
      <input type="checkbox" checked={enabled} disabled={!ready} onChange={(event) => {
        const value = event.target.checked;
        setReady(false);
        void chrome.storage.local.set({ [DEVELOPER_MODE_KEY]: value }).then(() => {
          setEnabled(value); setStatus('');
        }).catch(() => setStatus('Không lưu được tùy chọn developer mode.'))
          .finally(() => setReady(true));
      }} />
      <span>Developer mode — gửi mã lỗi kỹ thuật đến listener cục bộ (mặc định tắt).</span>
    </label>
    <small role="status">{enabled ? 'Đã bật gửi best-effort' : 'Đang tắt — không gửi lỗi mới'}; listener 127.0.0.1:3081 chưa xác nhận kết nối hoặc lưu log. Cần chạy listener riêng với đúng extension ID, không tunnel. Khi offline, log có thể bị bỏ sau tối đa hai lần thử. Không gửi prompt hoặc media.</small>
    {status && <span role="status">{status}</span>}
  </div>;
}
