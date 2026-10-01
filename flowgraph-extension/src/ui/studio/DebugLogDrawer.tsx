import React, { useState, useEffect } from 'react';
import { 
  Activity, CheckCircle2, XCircle, AlertTriangle, Clock, RefreshCw, 
  ChevronRight, ChevronDown, Copy, Check, Trash2, Terminal
} from 'lucide-react';

interface NodeRunLog {
  nodeId: string;
  status: 'success' | 'failed' | 'skipped';
  errorCode?: string;
  errorMessage?: string;
  diagnosticId?: string;
  result?: {
    type: 'image' | 'video';
    mediaId?: string;
    mimeType?: string;
    fileName?: string;
  };
}

interface RunRecord {
  runId: string;
  workflowId: string;
  workflowName: string;
  status: 'success' | 'failed' | 'cancelled';
  projectId: string;
  projectName: string;
  startedAt: string;
  finishedAt: string;
  nodeRuns: NodeRunLog[];
}

interface DebugLogDrawerProps {
  open: boolean;
  onClose: () => void;
  nodeTitles?: Record<string, string>;
  activeLiveEvents?: any[];
  liveStatus?: string;
}

const RUN_HISTORY_KEY = 'flowgraph.runHistory.v1';

export function DebugLogDrawer({ open, onClose, nodeTitles = {}, activeLiveEvents = [], liveStatus }: DebugLogDrawerProps) {
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string>('');
  const [copiedId, setCopiedId] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'realtime' | 'history'>('realtime');
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);

  const loadHistory = () => {
    try {
      const raw = localStorage.getItem(RUN_HISTORY_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as RunRecord[];
        setRuns(parsed);
        if (parsed.length > 0 && !selectedRunId) {
          setSelectedRunId(parsed[0].runId);
        }
      } else {
        setRuns([]);
      }
    } catch {
      setRuns([]);
    }
  };

  useEffect(() => {
    if (open) {
      loadHistory();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      if (clearConfirmOpen) setClearConfirmOpen(false);
      else onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose, clearConfirmOpen]);

  const clearHistory = () => {
    localStorage.removeItem(RUN_HISTORY_KEY);
    setRuns([]);
    setSelectedRunId('');
    setClearConfirmOpen(false);
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(''), 2000);
  };

  if (!open) return null;

  const currentRun = runs.find((r) => r.runId === selectedRunId) || runs[0];

  return (
    <aside className="debug-log-drawer" aria-label="Workflow execution logs">
      <div className="debug-log-header">
        <div className="debug-header-title">
          <Terminal size={16} className="text-purple" />
          <span>Workflow Execution & Debug Log</span>
          <span className="debug-run-count">{runs.length} runs</span>
          <div className="debug-mode-toggles">
            <button
              className={`debug-mode-btn ${activeTab === 'realtime' ? 'active' : ''}`}
              onClick={() => setActiveTab('realtime')}
            >
              <span className="live-dot" /> Live Events ({activeLiveEvents.length})
            </button>
            <button
              className={`debug-mode-btn ${activeTab === 'history' ? 'active' : ''}`}
              onClick={() => setActiveTab('history')}
            >
              Lịch sử ({runs.length})
            </button>
          </div>
        </div>
        <div className="debug-header-actions">
          <button className="debug-icon-btn" onClick={loadHistory} title="Làm mới log">
            <RefreshCw size={13} />
          </button>
          <button className="debug-icon-btn" onClick={() => setClearConfirmOpen(true)} title="Xóa lịch sử" aria-label="Xóa lịch sử chạy">
            <Trash2 size={13} />
          </button>
          <button className="debug-close-btn" onClick={onClose} title="Đóng bảng">
            ✕
          </button>
        </div>
      </div>

      {clearConfirmOpen && (
        <div className="debug-clear-confirm" role="alertdialog" aria-modal="true" aria-label="Xác nhận xóa lịch sử chạy">
          <span>Xóa toàn bộ lịch sử chạy đã lưu trên máy?</span>
          <button type="button" className="fg-btn" onClick={() => setClearConfirmOpen(false)}>Hủy</button>
          <button type="button" className="fg-btn fg-btn-danger" onClick={clearHistory}>Xóa</button>
        </div>
      )}

      <div className="debug-log-body">
        {activeTab === 'realtime' ? (
          <div className="debug-realtime-view">
            <div className="debug-realtime-toolbar">
              <div className="debug-realtime-status">
                <span className={`realtime-pulse ${liveStatus === 'running' ? 'active' : ''}`} />
                <span>Trạng thái luồng: <strong>{liveStatus === 'running' ? 'ĐANG CHẠY (EXECUTING)' : 'SẴN SÀNG (READY)'}</strong></span>
              </div>
              <div className="debug-realtime-meta">
                <span>Realtime Events: {activeLiveEvents.length}</span>
              </div>
            </div>
            <div className="debug-realtime-stream">
              {activeLiveEvents.length === 0 ? (
                <div className="debug-empty-detail">Chưa có sự kiện realtime nào. Bấm <strong>Chạy workflow</strong> để lắng nghe log trực tiếp theo từng mili-giây.</div>
              ) : (
                activeLiveEvents.map((evt, idx) => {
                  const isErr = evt.status === 'failed' || evt.kind?.includes('error');
                  const isWarn = evt.status === 'warning' || evt.kind?.includes('focus:steal');
                  const isSuccess = evt.status === 'success' || evt.kind?.includes('result');
                  const nodeTitle = nodeTitles[evt.nodeId] || evt.nodeId || 'System';
                  return (
                    <div key={idx} className={`realtime-event-row ${isErr ? 'event-error' : isWarn ? 'event-warning' : isSuccess ? 'event-success' : 'event-info'}`}>
                      <span className="realtime-time">
                        {(() => {
                          const d = new Date(evt.timestamp || Date.now());
                          const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                          const ms = String(d.getMilliseconds()).padStart(3, '0');
                          return `${timeStr}.${ms}`;
                        })()}
                      </span>
                      <span className="realtime-kind">[{evt.kind || evt.type || 'NODE'}]</span>
                      <strong className="realtime-node">{nodeTitle}</strong>
                      <span className={`realtime-badge ${evt.status || 'running'}`}>{(evt.status || 'running').toUpperCase()}</span>
                      {evt.error && (
                        <div className="realtime-err-detail">
                          <code>{evt.error.code}</code>: {evt.error.message}
                        </div>
                      )}
                      {evt.message && !evt.error && (
                        <div className="realtime-event-detail">
                          {evt.telemetry?.code && <><code>{evt.telemetry.code}</code>: </>}
                          {evt.message}
                          {evt.telemetry?.requestId && <> · request <code>{evt.telemetry.requestId}</code></>}
                          {evt.telemetry?.fromTabId !== undefined && evt.telemetry?.toTabId !== undefined && (
                            <> · tab <code>{evt.telemetry.fromTabId}</code> → <code>{evt.telemetry.toTabId}</code></>
                          )}
                        </div>
                      )}
                      {evt.result?.mediaId && (
                        <div className="realtime-media-detail">
                          Media ID: <code>{evt.result.mediaId}</code> ({evt.result.type})
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        ) : (
          <>
            {/* Cột trái: Danh sách các phiên chạy */}
            <div className="debug-runs-sidebar">
          <div className="debug-section-label">LỊCH SỬ PHIÊN CHẠY</div>
          {runs.length === 0 ? (
            <div className="debug-empty">Chưa có dữ liệu phiên chạy nào. Bấm Chạy workflow để bắt đầu.</div>
          ) : (
            <div className="debug-runs-list">
              {runs.map((r) => {
                const isSelected = r.runId === (currentRun?.runId);
                const hasFail = r.status === 'failed';
                const successCount = r.nodeRuns?.filter((n) => n.status === 'success').length || 0;
                const totalCount = r.nodeRuns?.length || 0;
                const timeStr = new Date(r.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

                return (
                  <div
                    key={r.runId}
                    className={`debug-run-item ${isSelected ? 'selected' : ''} ${hasFail ? 'is-failed' : 'is-success'}`}
                    role="button"
                    tabIndex={0}
                    aria-pressed={isSelected}
                    onClick={() => setSelectedRunId(r.runId)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setSelectedRunId(r.runId);
                      }
                    }}
                  >
                    <div className="debug-run-top">
                      <span className={`debug-status-dot ${r.status}`} />
                      <strong className="debug-run-name">{r.workflowName || 'Workflow'}</strong>
                      <span className="debug-run-time">{timeStr}</span>
                    </div>
                    <div className="debug-run-stats">
                      <span>Đạt: {successCount}/{totalCount} nodes</span>
                      <span className={`debug-badge ${r.status}`}>{r.status.toUpperCase()}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Cột phải: Chi tiết từng node của phiên đang chọn */}
        <div className="debug-details-view">
          {!currentRun ? (
            <div className="debug-empty-detail">Chọn một phiên chạy để xem chi tiết từng bước.</div>
          ) : (
            <>
              <div className="debug-run-banner">
                <div className="debug-banner-main">
                  <h3>{currentRun.workflowName}</h3>
                  <div className="debug-banner-meta">
                    <span>ID: <code>{currentRun.runId.slice(0, 8)}</code></span>
                    <span>Bắt đầu: {new Date(currentRun.startedAt).toLocaleTimeString()}</span>
                    <span>Kết thúc: {new Date(currentRun.finishedAt).toLocaleTimeString()}</span>
                  </div>
                </div>
                <div className={`debug-run-outcome ${currentRun.status}`}>
                  {currentRun.status === 'success' ? (
                    <><CheckCircle2 size={16} /> HOÀN THÀNH TOÀN DIỆN</>
                  ) : (
                    <><AlertTriangle size={16} /> CÓ LỖI XẢY RA</>
                  )}
                </div>
              </div>

              <div className="debug-nodes-container">
                <div className="debug-section-label">TIẾN TRÌNH CHI TIẾT TỪNG NODE ({currentRun.nodeRuns?.length || 0} nodes)</div>
                <div className="debug-node-list">
                  {currentRun.nodeRuns?.map((node, idx) => {
                    const nodeTitle = nodeTitles[node.nodeId] || node.nodeId;
                    const isError = node.status === 'failed';
                    const isSuccess = node.status === 'success';

                    return (
                      <div key={`${node.nodeId}-${idx}`} className={`debug-node-card ${node.status}`}>
                        <div className="debug-node-card-top">
                          <div className="debug-node-title-wrap">
                            {isSuccess ? (
                              <CheckCircle2 size={14} className="icon-success" />
                            ) : isError ? (
                              <XCircle size={14} className="icon-failed" />
                            ) : (
                              <Clock size={14} className="icon-skipped" />
                            )}
                            <span className="debug-node-title">{nodeTitle}</span>
                            <code className="debug-node-id">({node.nodeId})</code>
                          </div>
                          <span className={`debug-pill ${node.status}`}>
                            {node.status.toUpperCase()}
                          </span>
                        </div>

                        {/* Nếu có lỗi thì bung hộp thoại phân tích lỗi chi tiết */}
                        {isError && (
                          <div className="debug-error-box">
                            <div className="debug-error-head">
                              <span className="debug-error-code">Mã lỗi: {node.errorCode || 'RUNTIME_ERROR'}</span>
                              {node.diagnosticId && (
                                <span className="debug-diag-id">Diag ID: {node.diagnosticId}</span>
                              )}
                            </div>
                            <div className="debug-error-msg">
                              {node.errorMessage || 'Không nhận được thông điệp lỗi cụ thể từ executor.'}
                            </div>
                          </div>
                        )}

                        {/* Nếu thành công và có sản phẩm mediaId thì hiển thị */}
                        {isSuccess && node.result?.mediaId && (
                          <div className="debug-success-box">
                            <span className="debug-media-label">Kết quả ({node.result.type?.toUpperCase()}):</span>
                            <code className="debug-media-id">{node.result.mediaId}</code>
                            <button
                              className="debug-copy-btn"
                              onClick={() => handleCopy(node.result!.mediaId!, node.nodeId)}
                              title="Sao chép Media ID"
                            >
                              {copiedId === node.nodeId ? <Check size={12} className="text-green" /> : <Copy size={12} />}
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
          </>
        )}
      </div>
    </aside>
  );
}
