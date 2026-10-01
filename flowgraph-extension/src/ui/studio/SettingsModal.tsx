import React, { useState, useEffect, useRef } from 'react';
import { DeveloperModeToggle } from '../components/DeveloperModeToggle';
import {
  X,
  Settings as SettingsIcon,
  Bot,
  Palette,
  Cpu,
  Check,
  RefreshCw,
  Trash2,
  ExternalLink,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import {
  applyTheme,
  DEFAULT_THEME,
  normalizeTheme,
  THEME_DEFINITIONS,
  THEME_SETTINGS_STORAGE_KEY,
  type FlowGraphTheme,
} from '../themeSystem';

export interface FlowGraphSettings {
  // 1. AI & Gateway
  aiGatewayUrl: string;
  aiApiKey: string;
  aiModel: string;
  aiEnhanceStyle: string;
  // 2. Google Flow Defaults
  defaultAspectRatio: string;
  defaultImageModel: string;
  defaultVideoModel: string;
  defaultVideoDuration: number;
  autoRandomizeSeed: boolean;
  flowEntitlement: 'auto' | 'pro' | 'ultra';
  // 3. Canvas & Theme
  theme: FlowGraphTheme;
  gridSnap: boolean;
  gridSize: number;
  edgeType: 'bezier' | 'straight' | 'step';
  autoSave: boolean;
  // 4. Runtime & Debug
  enableDebugLogs: boolean;
  skipExperimentalPrompt: boolean;
}

export const DEFAULT_SETTINGS: FlowGraphSettings = {
  aiGatewayUrl: 'http://localhost:20128/v1',
  aiApiKey: '«redacted:sk-…»',
  aiModel: 'cx/gpt-5.6-luna',
  aiEnhanceStyle: 'AUTO',
  defaultAspectRatio: '16:9',
  defaultImageModel: 'IMAGE_MODEL_NANO_BANANA_2',
  defaultVideoModel: 'VIDEO_MODEL_VEO_2',
  defaultVideoDuration: 5,
  autoRandomizeSeed: true,
  flowEntitlement: 'auto',
  theme: DEFAULT_THEME,
  gridSnap: true,
  gridSize: 20,
  edgeType: 'bezier',
  autoSave: true,
  enableDebugLogs: true,
  skipExperimentalPrompt: false,
};

export function loadSettings(): FlowGraphSettings {
  try {
    const raw = localStorage.getItem(THEME_SETTINGS_STORAGE_KEY);
    if (raw) {
      const loaded = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } as FlowGraphSettings;
      loaded.theme = normalizeTheme(loaded.theme);
      return loaded;
    }
  } catch (e) {
    console.warn('Could not load settings from storage:', e);
  }
  return DEFAULT_SETTINGS;
}

export function saveSettings(settings: FlowGraphSettings): void {
  try {
    const normalized = { ...settings, theme: normalizeTheme(settings.theme) };
    localStorage.setItem(THEME_SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
    applyTheme(normalized.theme);
  } catch (e) {
    console.warn('Could not save settings to storage:', e);
  }
}

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  settings: FlowGraphSettings;
  onSave: (newSettings: FlowGraphSettings) => void;
}

type TabType = 'ai' | 'canvas' | 'runtime';

export function SettingsModal({ open, onClose, settings, onSave }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<TabType>('ai');
  const [form, setForm] = useState<FlowGraphSettings>(settings);
  const [testStatus, setTestStatus] = useState<{ testing: boolean; message: string; ok?: boolean } | null>(null);
  const [cacheSize, setCacheSize] = useState<string>('Đang tính...');
  const [clearCacheConfirm, setClearCacheConfirm] = useState(false);
  const [cacheMessage, setCacheMessage] = useState<string>('');
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [availableModels, setAvailableModels] = useState<string[]>(() => {
    try {
      const cached = localStorage.getItem('flowgraph.aiModels.v1');
      return cached ? JSON.parse(cached) : [];
    } catch {
      return [];
    }
  });

  const fetchModels = async (baseUrl: string, apiKey: string, showToast = false) => {
    const url = `${baseUrl.replace(/\/$/, '')}/models`;
    const headers: Record<string, string> = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
    try {
      let data: any = null;
      if (typeof chrome !== 'undefined' && chrome?.runtime?.sendMessage) {
        const bridgeRes: any = await new Promise((resolve) => {
          chrome.runtime.sendMessage(
            {
              type: 'FLOWGRAPH_PROXY_FETCH',
              payload: { url, method: 'GET', headers },
            },
            (reply) => resolve(reply)
          );
        });
        const resp = bridgeRes?.data || bridgeRes?.payload;
        if (resp?.ok) {
          data = JSON.parse(resp.text);
        } else {
          throw new Error(`HTTP ${resp?.status}: ${resp?.text || resp?.statusText || 'Fetch failed'}`);
        }
      } else {
        const res = await fetch(url, { headers });
        if (res.ok) {
          data = await res.json();
        } else {
          throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }
      }

      const list: string[] = (data?.data || [])
        .map((m: any) => m.id || m.name)
        .filter(Boolean)
        .sort();

      if (list.length > 0) {
        setAvailableModels(list);
        try {
          localStorage.setItem('flowgraph.aiModels.v1', JSON.stringify(list));
        } catch {}
        if (showToast) {
          setTestStatus({ testing: false, ok: true, message: `Kết nối thành công! Đã nạp ${list.length} models vào danh sách chọn.` });
        }
        return list;
      } else {
        throw new Error('Không tìm thấy model nào trong phản hồi.');
      }
    } catch (err) {
      if (showToast) {
        setTestStatus({ testing: false, ok: false, message: `Không thể kết nối Gateway: ${err instanceof Error ? err.message : String(err)}` });
      }
      return null;
    }
  };

  useEffect(() => {
    if (open) {
      setForm(settings);
      setTestStatus(null);
      setClearCacheConfirm(false);
      setCacheMessage('');
      // Auto fetch models on modal open if gateway url exists
      if (settings.aiGatewayUrl) {
        void fetchModels(settings.aiGatewayUrl, settings.aiApiKey, false);
      }
      // Calculate local media cache
      try {
        let itemsCount = 0;
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i) || '';
          if (k.startsWith('flowgraph.')) itemsCount++;
        }
        setCacheSize(`~${itemsCount} khóa cấu hình & phiên`);
      } catch {
        setCacheSize('Không xác định');
      }
    }
  }, [open, settings]);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusTimer = window.setTimeout(() => {
      dialogRef.current?.querySelector<HTMLElement>('.settings-tab-btn.active, button, input, select, textarea')?.focus();
    }, 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )].filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener('keydown', onKeyDown);
      previousFocusRef.current?.focus();
      previousFocusRef.current = null;
    };
  }, [open, onClose, settings.theme]);

  if (!open) return null;

  const closeWithoutSaving = () => {
    onClose();
  };

  const update = <K extends keyof FlowGraphSettings>(key: K, value: FlowGraphSettings[K]) => {
    const updated = { ...form, [key]: value };
    setForm(updated);
    saveSettings(updated);
    onSave(updated);
  };

  // Realtime instant save via update()

  const handleTestConnection = async () => {
    setTestStatus({ testing: true, message: 'Đang kiểm tra kết nối Gateway...' });
    await fetchModels(form.aiGatewayUrl, form.aiApiKey, true);
  };

  const handleClearCache = () => {
    try {
      localStorage.removeItem('flowgraph.runHistory.v1');
      setClearCacheConfirm(false);
      setCacheMessage('Đã xóa lịch sử chạy của Studio.');
      setCacheSize('Đã dọn lịch sử chạy');
    } catch (err) {
      setCacheMessage(`Không thể xóa lịch sử chạy: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div className="fg-modal-backdrop" onClick={closeWithoutSaving} role="presentation">
      <div
        ref={dialogRef}
        className="fg-modal settings-modal-content"
        role="dialog"
        aria-modal="true"
        aria-labelledby="flowgraph-settings-title"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="settings-modal-header">
          <div className="settings-title-wrap">
            <div className="settings-icon-badge"><SettingsIcon size={18} /></div>
            <div>
              <h2 id="flowgraph-settings-title" className="settings-title">Cài đặt FlowGraph Studio</h2>
              <p className="settings-subtitle">Tùy chỉnh AI Gateway, Canvas và hệ thống</p>
            </div>
          </div>
          <button className="settings-close-btn" onClick={closeWithoutSaving} aria-label="Đóng cài đặt"><X size={18} /></button>
        </div>

        {/* Body Layout: Sidebar Tabs + Content */}
        <div className="settings-modal-body">
          {/* Tabs Navigation */}
          <div className="settings-tabs-sidebar">
            <button
              className={`settings-tab-btn ${activeTab === 'ai' ? 'active' : ''}`}
              onClick={() => setActiveTab('ai')}
            >
              <Bot size={16} />
              <div className="tab-text">
                <span className="tab-name">AI & Gateway</span>
                <span className="tab-desc">Gemini, OpenAI, 9router</span>
              </div>
            </button>

            <button
              className={`settings-tab-btn ${activeTab === 'canvas' ? 'active' : ''}`}
              onClick={() => setActiveTab('canvas')}
            >
              <Palette size={16} />
              <div className="tab-text">
                <span className="tab-name">Canvas & Theme</span>
                <span className="tab-desc">Giao diện, Lưới, Dây nối</span>
              </div>
            </button>

            <button
              className={`settings-tab-btn ${activeTab === 'runtime' ? 'active' : ''}`}
              onClick={() => setActiveTab('runtime')}
            >
              <Cpu size={16} />
              <div className="tab-text">
                <span className="tab-name">Hệ thống & Log</span>
                <span className="tab-desc">Debug, Bộ nhớ đệm, Cache</span>
              </div>
            </button>
          </div>

          {/* Tab Content Panel */}
          <div className="settings-tab-panel">
            {/* 1. TAB AI & GATEWAY */}
            {activeTab === 'ai' && (
              <div className="settings-section">
                <h3 className="section-heading">Google Flow & AI Gateway</h3>
                <p className="section-tip">Cấu hình entitlement của Google Flow và AI Prompt Enhancer dùng trong workflow.</p>

                <div className="form-group">
                  <label className="form-label">Google Flow plan / entitlement</label>
                  <select
                    className="form-select"
                    value={form.flowEntitlement}
                    onChange={(e) => update('flowEntitlement', e.target.value as FlowGraphSettings['flowEntitlement'])}
                  >
                    <option value="auto">Auto detect từ Google Flow</option>
                    <option value="pro">Google AI Pro</option>
                    <option value="ultra">Google AI Ultra</option>
                  </select>
                  <span className="input-hint">
                    Ultra bật SERVICE_TIER_ADVANCED: các variant 4s/6s theo registry, Veo Lite Lower Priority, pricing Ultra và 4K upscale. Auto vẫn được ưu tiên khi entitlement API hoạt động.
                  </span>
                </div>

                <div className="form-group">
                  <label className="form-label">Gateway Base URL (OpenAI-compatible)</label>
                  <input
                    type="text"
                    className="form-input"
                    value={form.aiGatewayUrl}
                    onChange={(e) => update('aiGatewayUrl', e.target.value)}
                    placeholder="http://127.0.0.1:20128/v1"
                  />
                  <span className="input-hint">Hỗ trợ 9router local, PipoGateway, Antigravityx hoặc OpenAI chính thức.</span>
                </div>

                <div className="form-group">
                  <label className="form-label">API Key / Access Token</label>
                  <input
                    type="password"
                    className="form-input"
                    value={form.aiApiKey}
                    onChange={(e) => update('aiApiKey', e.target.value)}
                    placeholder="sk-... (Để trống nếu Gateway không yêu cầu)"
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">
                    Model AI Enhance mặc định
                    {availableModels.length > 0 && (
                      <span className="input-hint" style={{ display: 'inline', marginLeft: 8 }}>
                        ({availableModels.length} models sẵn sàng)
                      </span>
                    )}
                  </label>
                  {availableModels.length > 0 ? (
                    <select
                      className="form-select"
                      value={form.aiModel}
                      onChange={(e) => update('aiModel', e.target.value)}
                    >
                      {!availableModels.includes(form.aiModel) && form.aiModel && (
                        <option value={form.aiModel}>{form.aiModel} (Hiện tại)</option>
                      )}
                      {availableModels.map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      className="form-input"
                      value={form.aiModel}
                      onChange={(e) => update('aiModel', e.target.value)}
                      placeholder="cx/gpt-5.6-luna hoặc ag/gemini-3.8-flash-high"
                    />
                  )}
                </div>

                <div className="connection-test-box">
                  <button
                    type="button"
                    className="fg-btn fg-btn-secondary"
                    onClick={handleTestConnection}
                    disabled={testStatus?.testing}
                  >
                    {testStatus?.testing ? <RefreshCw size={14} className="spin" /> : <Sparkles size={14} />}
                    Kiểm tra kết nối AI Gateway
                  </button>
                  {testStatus && (
                    <span className={`test-result-badge ${testStatus.ok ? 'success' : 'error'}`}>
                      {testStatus.message}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* 2. TAB CANVAS & THEME */}
            {activeTab === 'canvas' && (
              <div className="settings-section">
                <h3 className="section-heading">Tùy chỉnh Giao diện Canvas & Chủ đề (Theme)</h3>
                <p className="section-tip">Thay đổi màu sắc, độ tương phản và cảm giác thao tác trên không gian đồ họa.</p>

                <div className="form-group">
                  <label className="form-label">Chủ đề giao diện (Theme)</label>
                  <div className="theme-selector-grid theme-selector-grid-8">
                    {THEME_DEFINITIONS.map((th) => (
                      <button
                        type="button"
                        key={th.id}
                        className={`theme-card ${form.theme === th.id ? 'active' : ''}`}
                        aria-pressed={form.theme === th.id}
                        data-theme-option={th.id}
                        onClick={() => update('theme', th.id)}
                      >
                        <span className="theme-color-dot" style={{ backgroundColor: th.swatch }} />
                        <span className="theme-info">
                          <span className="theme-name">{th.label}</span>
                          <span className="theme-desc">{th.description}</span>
                        </span>
                        {form.theme === th.id && <Check size={16} className="theme-check-icon" />}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group flex-1">
                    <label className="form-label">Kiểu đường nối dây (Edge Style)</label>
                    <select
                      className="form-select"
                      value={form.edgeType}
                      onChange={(e) => update('edgeType', e.target.value as FlowGraphSettings['edgeType'])}
                    >
                      <option value="bezier">Cubic Bezier (Đường cong mềm mại)</option>
                      <option value="step">Step Curve (Đường vuông góc né node)</option>
                      <option value="straight">Straight Line (Đường thẳng trực tiếp)</option>
                    </select>
                  </div>

                  <div className="form-group flex-1">
                    <label className="form-label">Kích thước bước lưới (Grid Size)</label>
                    <select
                      className="form-select"
                      value={form.gridSize}
                      onChange={(e) => update('gridSize', Number(e.target.value))}
                    >
                      <option value={15}>15px (Mịn)</option>
                      <option value={20}>20px (Tiêu chuẩn)</option>
                      <option value={30}>30px (Rộng)</option>
                    </select>
                  </div>
                </div>

                <div className="checkbox-row">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={form.gridSnap}
                      onChange={(e) => update('gridSnap', e.target.checked)}
                    />
                    <span>Hít theo lưới (Snap to Grid) khi kéo thả node trên Canvas</span>
                  </label>
                </div>

                <div className="checkbox-row">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={form.autoSave}
                      onChange={(e) => update('autoSave', e.target.checked)}
                    />
                    <span>Tự động lưu trạng thái Canvas vào bộ nhớ trình duyệt</span>
                  </label>
                </div>
              </div>
            )}

            {/* 4. TAB RUNTIME & DEBUG */}
            {activeTab === 'runtime' && (
              <div className="settings-section">
                <h3 className="section-heading">Quản trị Hệ thống, Bộ nhớ đệm & Bắt lỗi</h3>
                <p className="section-tip">Theo dõi dung lượng, xóa cache và bật nhật ký chi tiết chuỗi workflow.</p>

                <div className="system-status-box">
                  <div className="status-row">
                    <span>Trạng thái bộ nhớ tạm:</span>
                    <strong>{cacheSize}</strong>
                  </div>
                  {!clearCacheConfirm ? (
                    <button
                      type="button"
                      className="fg-btn fg-btn-danger-outline"
                      onClick={() => { setClearCacheConfirm(true); setCacheMessage(''); }}
                    >
                      <Trash2 size={14} /> Xóa lịch sử chạy
                    </button>
                  ) : (
                    <div className="settings-confirm-row" role="alert">
                      <span>Xóa toàn bộ lịch sử chạy đã lưu trên máy?</span>
                      <button type="button" className="fg-btn" onClick={() => setClearCacheConfirm(false)}>Hủy</button>
                      <button type="button" className="fg-btn fg-btn-danger" onClick={handleClearCache}>Xóa</button>
                    </div>
                  )}
                  {cacheMessage ? <div className="settings-inline-status" role="status">{cacheMessage}</div> : null}
                </div>

                <div className="checkbox-row">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={form.enableDebugLogs}
                      onChange={(e) => update('enableDebugLogs', e.target.checked)}
                    />
                    <span>Ghi log chi tiết (Execution Logs) vào <code>localStorage.flowgraph.runHistory.v1</code></span>
                  </label>
                </div>
                <DeveloperModeToggle />

                <div className="checkbox-row">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={form.skipExperimentalPrompt}
                      onChange={(e) => update('skipExperimentalPrompt', e.target.checked)}
                    />
                    <span>Tự động chấp nhận modal cảnh báo tính năng thử nghiệm (Run anyway)</span>
                  </label>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
