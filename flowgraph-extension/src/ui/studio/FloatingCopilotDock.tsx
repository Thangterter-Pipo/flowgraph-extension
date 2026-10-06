import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { FlowEdge, FlowNode } from './model';
import type { WorkflowTemplate } from './workflowTemplates';
import type { RunStatus } from './model';
import type { WorkflowRunMode } from './workflowRunMode';
import { FlowGraphAgent } from '../../agent/FlowGraphAgent';
import { loadSettings, saveSettings } from './SettingsModal';
import { useDockGesture } from './copilot/useDockGesture';
import type {
  AgentApprovalRequest,
  AgentStatus,
  AgentStep,
} from '../../agent/types';
import {
  Bot,
  ArrowRight,
  Sparkles,
  X,
  Play,
  Square,
  CheckCircle,
  AlertCircle,
  ChevronDown,
  Film,
  Layers,
  Wrench,
  RotateCcw,
  Plus,
  Minus,
  GripVertical,
  Trash2,
  FileText,
  Image as ImageIcon,
  Video as VideoIcon,
  Music,
} from 'lucide-react';

export interface AttachedFile {
  id: string;
  name: string;
  size: number;
  type: 'image' | 'video' | 'audio' | 'document';
  supported: boolean;
  unsupportedReason?: string;
  dataUrl?: string;
  textContent?: string;
}

export interface FloatingCopilotDockProps {
  nodes?: FlowNode[];
  edges?: FlowEdge[];
  setNodes?: React.Dispatch<React.SetStateAction<FlowNode[]>>;
  setEdges?: React.Dispatch<React.SetStateAction<FlowEdge[]>>;
  activeProject?: { projectId: string } | null;
  onApplyTemplate?: (template: WorkflowTemplate) => void;
  onFitView?: () => void;
  isCanvasLocked?: boolean;
  onRunWorkflow?: (mode?: WorkflowRunMode) => Promise<void>;
  onCancelRun?: () => void;
  runStatus?: RunStatus;
  runFeedback?: string;
  runError?: { code?: string; message?: string } | null;
  onUndo?: () => void;
  canUndo?: boolean;
  onRedo?: () => void;
  canRedo?: boolean;
  onAutoLayout?: () => void;
  onReset?: () => void;
  onBeforeGraphMutation?: () => void;
}

const DEFAULT_MODELS = [
  { id: 'claude-sonnet-4.6', label: 'Claude Sonnet 4.6 (Thinking)' },
  { id: 'cx/gpt-5.6-luna', label: 'GPT-5.6 Luna' },
  { id: 'ag/gemini-3.8-flash-high', label: 'Gemini 3.8 Flash High' },
  { id: 'cx/gpt-6-astra', label: 'GPT-6 Astra' },
  { id: 'claude-opus-4-7', label: 'Claude Opus 4.7' },
];

const TOOL_LABELS: Record<string, string> = {
  get_available_nodes: 'đọc thư viện node',
  get_current_graph: 'đọc trạng thái canvas',
  add_node: 'thêm node',
  update_node_config: 'cập nhật cấu hình node',
  connect_nodes: 'nối node',
  disconnect_edge: 'gỡ đường nối',
  remove_node: 'xóa node',
  clear_canvas: 'làm trống canvas',
  auto_layout: 'sắp xếp lại canvas',
  validate_graph: 'kiểm tra workflow',
  request_render_approval: 'chuẩn bị đề xuất render',
  trigger_render: 'khởi chạy render',
  get_run_status: 'kiểm tra tiến độ',
  cancel_render: 'dừng render',
};

function compactText(value: unknown, maxLength = 220): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function toolLabel(toolName?: string): string {
  return (toolName && TOOL_LABELS[toolName]) || 'tác vụ trên workflow';
}

function statusLabel(status: AgentStatus): string {
  switch (status) {
    case 'running': return 'Đang xử lý';
    case 'awaiting_approval': return 'Chờ xác nhận';
    case 'rendering': return 'Đang render';
    case 'success': return 'Hoàn tất';
    case 'error': return 'Có lỗi';
    case 'aborted': return 'Đã dừng';
    default: return 'Sẵn sàng';
  }
}

function publicStepTitle(step: AgentStep): string {
  if (step.type === 'thought') {
    return step.title.includes('Khởi động') ? 'Đã tiếp nhận yêu cầu' : 'Đang phân tích kịch bản';
  }
  if (step.type === 'tool_call') return `Đang ${toolLabel(step.toolName)}`;
  if (step.type === 'tool_result') return `Đã ${toolLabel(step.toolName)}`;
  if (step.type === 'approval_required') return 'Cần bạn xác nhận trước khi render';
  if (step.type === 'render_started') return 'Đã khởi chạy render';
  if (step.type === 'error') return 'Có lỗi khi thực hiện tác vụ';
  return 'Đã hoàn tất quy trình';
}

function publicStepDetails(step: AgentStep): string {
  if (step.type === 'thought') {
    return step.title.includes('Khởi động')
      ? 'AI đang chuẩn bị phương án cho workflow hiện tại.'
      : 'AI đang xây dựng cấu trúc hình ảnh và các bước thực thi phù hợp.';
  }

  if (step.type === 'tool_result') {
    const result = step.toolResult as Record<string, unknown> | undefined;
    if (step.toolName === 'clear_canvas') {
      if (result?.cancelled) return 'Canvas được giữ nguyên theo lựa chọn của bạn.';
      if (result?.changed === false) return 'Canvas đã trống, không có dữ liệu nào bị thay đổi.';
      if (result?.success) {
        return `Đã xóa ${Number(result.removedNodeCount ?? 0)} node và ${Number(result.removedEdgeCount ?? 0)} đường nối. Bạn có thể hoàn tác bằng Ctrl+Z.`;
      }
    }
    if (result?.success === false && typeof result.message === 'string') return compactText(result.message);
    if (typeof result?.message === 'string') return compactText(result.message);
    return 'Tác vụ đã được xử lý trên workflow hiện tại.';
  }

  if (step.type === 'tool_call') return 'Đang cập nhật trạng thái workflow…';
  if (step.type === 'error') return compactText(step.details) || 'Vui lòng kiểm tra lại yêu cầu hoặc thử lại.';
  if (step.type === 'success') return compactText(step.details) || 'Workflow đã sẵn sàng để bạn kiểm tra.';
  if (step.type === 'approval_required') return 'Kiểm tra nội dung và xác nhận khi bạn đã sẵn sàng.';
  if (step.type === 'render_started') return compactText(step.details) || 'Quá trình render đang được thực hiện.';
  return '';
}

function technicalStepDetails(step: AgentStep): string | null {
  if (step.type !== 'tool_call' && step.type !== 'tool_result') return null;
  const payload = step.type === 'tool_call'
    ? { tool: step.toolName, arguments: step.toolArgs }
    : { tool: step.toolName, result: step.toolResult };
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return null;
  }
}

export function FloatingCopilotDock({
  nodes = [],
  edges = [],
  setNodes,
  setEdges,
  activeProject,
  onApplyTemplate,
  onFitView,
  isCanvasLocked,
  onRunWorkflow,
  onCancelRun,
  runStatus = 'ready',
  runFeedback,
  runError,
  onBeforeGraphMutation,
}: FloatingCopilotDockProps) {
  const { panelRef, side, begin } = useDockGesture();

  const [prompt, setPrompt] = useState('');
  const [agentStatus, setAgentStatus] = useState<AgentStatus>('idle');
  const [steps, setSteps] = useState<AgentStep[]>([]);
  const [showSteps, setShowSteps] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [approvalRequest, setApprovalRequest] = useState<AgentApprovalRequest | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Model AI hiện tại
  const [currentModel, setCurrentModel] = useState<string>(() => {
    try {
      const s = loadSettings();
      return s.aiModel || 'claude-sonnet-4.6';
    } catch {
      return 'claude-sonnet-4.6';
    }
  });
  const [showModelDropdown, setShowModelDropdown] = useState(false);

  // Quản lý tệp đính kèm
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const modelDropdownRef = useRef<HTMLDivElement>(null);
  const conversationEndRef = useRef<HTMLDivElement>(null);

  const agentRef = useRef<FlowGraphAgent | null>(null);
  const approvalResolverRef = useRef<((approved: boolean) => void) | null>(null);
  const agentMutationSnapshotTakenRef = useRef(false);

  const nodesRef = useRef<FlowNode[]>(nodes);
  const edgesRef = useRef<FlowEdge[]>(edges);
  const activeProjectRef = useRef(activeProject);

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => {
    edgesRef.current = edges;
  }, [edges]);

  useEffect(() => {
    activeProjectRef.current = activeProject;
  }, [activeProject]);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(e.target as Node)) {
        setShowModelDropdown(false);
      }
    };
    if (showModelDropdown) {
      document.addEventListener('mousedown', handleOutsideClick);
    }
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [showModelDropdown]);

  const handleSelectModel = (modelId: string) => {
    setCurrentModel(modelId);
    setShowModelDropdown(false);
    try {
      const s = loadSettings();
      saveSettings({ ...s, aiModel: modelId });
    } catch {}
  };

  // Tự co giãn textarea theo nội dung
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  }, [prompt]);

  const processFiles = useCallback((files: FileList | File[]) => {
    const fileList = Array.from(files);
    fileList.forEach((file) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      let type: AttachedFile['type'] = 'document';
      let supported = true;
      let unsupportedReason: string | undefined;

      if (file.type.startsWith('image/')) {
        type = 'image';
      } else if (file.type.startsWith('video/')) {
        type = 'video';
        supported = false;
        unsupportedReason = 'Chưa hỗ trợ đọc nội dung video';
      } else if (file.type.startsWith('audio/')) {
        type = 'audio';
        supported = false;
        unsupportedReason = 'Chưa hỗ trợ đọc nội dung audio';
      } else {
        const ext = file.name.split('.').pop()?.toLowerCase();
        if (ext === 'txt' || ext === 'md' || ext === 'json' || ext === 'csv') {
          type = 'document';
          supported = true;
        } else {
          type = 'document';
          supported = false;
          unsupportedReason = `Định dạng .${ext || 'file'} chưa hỗ trợ đọc nội dung`;
        }
      }

      const fileItem: AttachedFile = {
        id,
        name: file.name,
        size: file.size,
        type,
        supported,
        unsupportedReason,
      };

      if (type === 'image') {
        const reader = new FileReader();
        reader.onload = () => {
          fileItem.dataUrl = reader.result as string;
          setAttachedFiles((prev) => [...prev, fileItem]);
        };
        reader.readAsDataURL(file);
      } else if (supported && type === 'document') {
        const reader = new FileReader();
        reader.onload = () => {
          fileItem.textContent = reader.result as string;
          setAttachedFiles((prev) => [...prev, fileItem]);
        };
        reader.readAsText(file);
      } else {
        setAttachedFiles((prev) => [...prev, fileItem]);
      }
    });
  }, []);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
    if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
      processFiles(e.dataTransfer.files);
    }
  };

  const handleRemoveFile = (fileId: string) => {
    setAttachedFiles((prev) => prev.filter((f) => f.id !== fileId));
  };

  const handleClearChat = () => {
    if (agentStatus === 'running') return;
    setSteps([]);
    setFeedback(null);
    setApprovalRequest(null);
    setAttachedFiles([]);
    setPrompt('');
  };

  const handleSend = async () => {
    let fullPrompt = prompt.trim();
    const docTexts = attachedFiles
      .filter((f) => f.supported && f.textContent)
      .map((f) => `--- Tài liệu đính kèm: ${f.name} ---\n${f.textContent}`)
      .join('\n\n');

    if (docTexts) {
      fullPrompt = fullPrompt ? `${fullPrompt}\n\n${docTexts}` : docTexts;
    }

    const hasContent = Boolean(fullPrompt || attachedFiles.some((f) => f.supported));
    if (!hasContent || isCanvasLocked || agentStatus === 'running' || agentStatus === 'awaiting_approval') {
      return;
    }

    setApprovalRequest(null);
    setSteps([]);
    setShowSteps(true);
    setFeedback('Đạo diễn AI bắt đầu phân tích kịch bản & thiết kế quy trình...');
    agentMutationSnapshotTakenRef.current = false;

    const agent = new FlowGraphAgent(
      {
        getNodes: () => nodesRef.current,
        setNodes: (updater) => {
          if (setNodes) {
            setNodes(updater);
            setTimeout(() => onFitView?.(), 100);
          }
        },
        getEdges: () => edgesRef.current,
        setEdges: (updater) => {
          if (setEdges) {
            setEdges(updater);
          }
        },
        getActiveProject: () => activeProjectRef.current || null,
        onBeforeGraphMutation: () => {
          if (agentMutationSnapshotTakenRef.current) return;
          agentMutationSnapshotTakenRef.current = true;
          onBeforeGraphMutation?.();
        },
        onRequestApproval: (request: AgentApprovalRequest) => {
          setApprovalRequest(request);
          setAgentStatus('awaiting_approval');
          setShowSteps(false);
          return new Promise<boolean>((resolve) => {
            approvalResolverRef.current = resolve;
          });
        },
        onRunWorkflow: (mode) => {
          if (onRunWorkflow) {
            onRunWorkflow(mode || 'continue');
          }
        },
        getRunStatus: () => runStatus || 'idle',
        getRunFeedback: () => runFeedback || '',
        onCancelRun: () => {
          if (onCancelRun) {
            onCancelRun();
          }
        },
      },
      {
        maxTurns: 12,
        onStatusChange: (status) => setAgentStatus(status),
        onStep: (step) => {
          setSteps((prev) => [...prev, step]);
          const visibleTitle = publicStepTitle(step);
          const visibleDetails = publicStepDetails(step);
          if (step.type === 'tool_call') {
            setFeedback(visibleTitle);
          } else if (visibleDetails) {
            setFeedback(visibleDetails);
          }
        },
      }
    );

    agentRef.current = agent;

    try {
      const res = await agent.runPrompt(fullPrompt);
      if (res.success) {
        setFeedback(compactText(res.summary) || 'Đã dựng xong quy trình theo kịch bản.');
        setAttachedFiles([]);
        setPrompt('');
      } else {
        setFeedback(compactText(res.error) || 'Agent kết thúc với lỗi.');
      }
    } catch (err: any) {
      setFeedback(`Lỗi: ${compactText(err?.message) || 'Không thể thực thi Agent'}`);
    }
  };

  const handleStop = () => {
    if (agentRef.current) {
      agentRef.current.abort();
      agentRef.current = null;
    }
    if (approvalResolverRef.current) {
      approvalResolverRef.current(false);
      approvalResolverRef.current = null;
    }
    setApprovalRequest(null);
    setAgentStatus('aborted');
    setFeedback('Đã dừng tác vụ Agent.');
  };

  const handleApproveApproval = async () => {
    const request = approvalRequest;
    if (!request) return;
    if (approvalResolverRef.current) {
      approvalResolverRef.current(true);
      approvalResolverRef.current = null;
    }
    setApprovalRequest(null);

    if (request.kind === 'destructive') {
      setAgentStatus('running');
      setFeedback('Đã xác nhận. Đang cập nhật canvas và lưu mốc hoàn tác...');
      return;
    }

    setAgentStatus('rendering');
    setFeedback('Đã duyệt! Bắt đầu chạy render quy trình video...');

    try {
      if (onRunWorkflow) {
        await onRunWorkflow('restart');
      }
    } catch (err: any) {
      setFeedback(`Lỗi khởi chạy render: ${compactText(err?.message) || 'Không thể bắt đầu'}`);
    }
  };

  const handleRejectApproval = () => {
    const request = approvalRequest;
    if (approvalResolverRef.current) {
      approvalResolverRef.current(false);
      approvalResolverRef.current = null;
    }
    setApprovalRequest(null);
    setAgentStatus('running');
    setFeedback(request?.kind === 'destructive'
      ? 'Đã hủy. Canvas được giữ nguyên, không có dữ liệu nào bị xóa.'
      : 'Đã hủy yêu cầu render. Bạn có thể yêu cầu Agent chỉnh sửa lại các cảnh.');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const activeModelLabel = DEFAULT_MODELS.find((m) => m.id === currentModel)?.label || currentModel;

  if (isCollapsed) {
    return (
      <aside
        className={`copilot-dock-panel dock-${side} copilot-dock-collapsed nodrag nopan`}
        ref={panelRef}
        onClick={() => setIsCollapsed(false)}
        title="Mở AI Director"
      >
        <button
          type="button"
          className="copilot-collapsed-trigger"
          onClick={() => setIsCollapsed(false)}
          aria-label="Mở AI Director"
        >
          <Bot size={15} />
          <span className={`copilot-status-dot status-${agentStatus}`} />
        </button>
      </aside>
    );
  }

  return (
    <aside
      className={`copilot-dock-panel dock-${side} nodrag nopan`}
      ref={panelRef}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Divider chỉnh kích thước */}
      {side === 'right' && (
        <div
          className="copilot-resize-divider divider-left"
          onPointerDown={(e) => begin(e, true)}
        />
      )}
      {side === 'left' && (
        <div
          className="copilot-resize-divider divider-right"
          onPointerDown={(e) => begin(e, true)}
        />
      )}
      {side === 'bottom' && (
        <div
          className="copilot-resize-divider divider-top"
          onPointerDown={(e) => begin(e, true)}
        />
      )}

      {/* Header kéo thả: Bố kéo thanh này sang mép trái/phải/đáy để neo */}
      <header
        className="copilot-panel-header"
        onPointerDown={(e) => begin(e, false)}
      >
        <div className="copilot-header-drag-zone">
          <GripVertical size={13} className="copilot-drag-icon" />
          <div className="copilot-title-group">
            <span className="copilot-title-text">AI Director</span>
            <span className={`copilot-status-dot status-${agentStatus}`} />
          </div>
        </div>

        <div className="copilot-header-actions" onPointerDown={(e) => e.stopPropagation()}>
          {steps.length > 0 && (
            <button
              type="button"
              className="copilot-ghost-icon-btn"
              onClick={() => setShowSteps(!showSteps)}
              title="Nhật ký"
            >
              <Film size={13} />
            </button>
          )}
          <button
            type="button"
            className="copilot-ghost-icon-btn"
            onClick={handleClearChat}
            disabled={agentStatus === 'running'}
            title="Làm mới"
          >
            <RotateCcw size={13} />
          </button>
          <button
            type="button"
            className="copilot-ghost-icon-btn"
            onClick={() => setIsCollapsed(true)}
            title="Thu gọn"
          >
            <Minus size={13} />
          </button>
        </div>
      </header>

      {/* Overlay khi Drag & Drop tệp */}
      {isDraggingOver && (
        <div className="copilot-drop-target-overlay">
          <Plus size={16} />
          <span>Thả tệp</span>
        </div>
      )}

      {/* Input File ẩn */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".txt,.md,.json,.csv,image/*,video/*,audio/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          if (e.target.files) processFiles(e.target.files);
        }}
      />

      {/* Vùng nội dung cuộn độc lập */}
      <div className="copilot-panel-content">
        {/* Phản hồi trạng thái / Toast */}
        {feedback && (
          <div className="copilot-inline-status" role="status">
            <Sparkles size={12} className="copilot-sparkle-glyph" />
            <span className="copilot-status-message">{feedback}</span>
            <button
              type="button"
              className="copilot-dismiss-btn"
              onClick={() => setFeedback(null)}
              title="Đóng thông báo"
            >
              <X size={11} />
            </button>
          </div>
        )}

        {/* Lỗi thực thi nếu có */}
        {runError && (
          <div className="copilot-inline-error">
            <AlertCircle size={13} />
            <span>{runError.message || runError.code || 'Lỗi quy trình'}</span>
          </div>
        )}

        {/* Card xác nhận render hoặc thao tác phá hủy */}
        {approvalRequest && (
          <div className={`copilot-approval-card ${approvalRequest.kind === 'destructive' ? 'is-destructive' : ''}`} role="dialog" aria-modal="true" aria-labelledby="approval-title">
            <div className="approval-card-header">
              <div className="approval-card-title-group">
                {approvalRequest.kind === 'destructive' ? <Trash2 size={14} /> : <Film size={14} />}
                <h4 id="approval-title">{approvalRequest.title || 'Duyệt Kịch Bản & Quy Trình Render'}</h4>
              </div>
              {approvalRequest.kind === 'destructive' ? (
                <span className="approval-danger-tag">Thay đổi canvas</span>
              ) : (
                <span className="approval-credits-tag">
                  {approvalRequest.estimatedCredits || 'Tiêu chuẩn'}
                </span>
              )}
            </div>

            <p className="approval-card-summary">{approvalRequest.summary}</p>

            {approvalRequest.kind === 'destructive' ? (
              <div className="approval-impact-box">
                <div className="approval-scenes-header">
                  <Trash2 size={12} />
                  <span>Phạm vi thay đổi</span>
                </div>
                <div className="approval-impact-counts">
                  <strong>{approvalRequest.nodeCount}</strong><span>node</span>
                  <strong>{approvalRequest.edgeCount}</strong><span>đường nối</span>
                </div>
                <p>FlowGraph sẽ lưu một mốc để bạn có thể hoàn tác bằng Ctrl+Z.</p>
              </div>
            ) : (
              <div className="approval-card-scenes-box">
                <div className="approval-scenes-header">
                  <Layers size={12} />
                  <span>Phân cảnh đã thiết kế ({approvalRequest.scenes?.length || 0}):</span>
                </div>
                <div className="approval-scenes-scroll">
                  {approvalRequest.scenes?.map((sc) => (
                    <div key={sc.index} className="approval-scene-row">
                      <span className="scene-idx">#{sc.index}</span>
                      <div className="scene-text-wrap">
                        <span className="scene-name">{sc.title}</span>
                        <span className="scene-desc">{sc.prompt}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="approval-meta-row">
              <span>{approvalRequest.nodeCount} node</span>
              <span>·</span>
              <span>{approvalRequest.edgeCount} đường nối</span>
              {approvalRequest.kind !== 'destructive' && <><span>·</span><span>Đồ thị hợp lệ</span></>}
            </div>

            <div className="approval-card-actions">
              <button
                type="button"
                className="fg-btn fg-btn-secondary"
                onClick={handleRejectApproval}
              >
                {approvalRequest.kind === 'destructive' ? 'Giữ nguyên' : 'Chỉnh sửa'}
              </button>
              <button
                type="button"
                className={`fg-btn ${approvalRequest.kind === 'destructive' ? 'fg-btn-danger' : 'fg-btn-primary'}`}
                onClick={() => void handleApproveApproval()}
              >
                {approvalRequest.kind === 'destructive' ? <Trash2 size={12} /> : <Play size={12} />}
                <span>{approvalRequest.kind === 'destructive' ? 'Xóa canvas' : 'Duyệt & Chạy'}</span>
              </button>
            </div>
          </div>
        )}

        {/* Nhật ký hoạt động người dùng; chi tiết kỹ thuật chỉ hiển thị khi mở */}
        {showSteps && steps.length > 0 && (
          <div className="copilot-steps-container">
            <div className="copilot-steps-heading">
              <div className="copilot-steps-title">
                <span>Hoạt động của AI</span>
                <span className="copilot-steps-count">{steps.length} bước</span>
              </div>
              <button
                type="button"
                className="copilot-steps-hide-btn"
                onClick={() => setShowSteps(false)}
              >
                Ẩn
              </button>
            </div>
            <div className="copilot-steps-list">
              {steps.map((st) => (
                <div key={st.id} className={`copilot-step-entry type-${st.type}`}>
                  <div className="step-entry-header">
                    {st.type === 'tool_call' && <Wrench size={11} />}
                    {st.type === 'tool_result' && <CheckCircle size={11} />}
                    {st.type === 'thought' && <Bot size={11} />}
                    {st.type === 'error' && <AlertCircle size={11} />}
                    {st.type === 'success' && <Film size={11} />}
                    {st.type === 'approval_required' && <AlertCircle size={11} />}
                    {st.type === 'render_started' && <Play size={11} />}
                    <span>{publicStepTitle(st)}</span>
                  </div>
                  {publicStepDetails(st) && (
                    <div className="step-entry-details">
                      {publicStepDetails(st)}
                    </div>
                  )}
                  {technicalStepDetails(st) && (
                    <details className="copilot-step-technical">
                      <summary>Chi tiết kỹ thuật</summary>
                      <pre>{technicalStepDetails(st)}</pre>
                    </details>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div ref={conversationEndRef} />
      </div>

      {/* Composer cố định ở đáy panel */}
      <footer className="copilot-panel-composer">
        {/* Khay tệp đính kèm */}
        {attachedFiles.length > 0 && (
          <div className="copilot-attachment-tray">
            {attachedFiles.map((file) => (
              <div
                key={file.id}
                className={`copilot-tray-chip ${file.supported ? 'supported' : 'unsupported'}`}
                title={file.unsupportedReason || `${file.name} (${Math.round(file.size / 1024)} KB)`}
              >
                {file.type === 'image' && file.dataUrl ? (
                  <img src={file.dataUrl} alt={file.name} className="chip-preview-img" />
                ) : file.type === 'image' ? (
                  <ImageIcon size={12} className="chip-type-icon" />
                ) : file.type === 'video' ? (
                  <VideoIcon size={12} className="chip-type-icon" />
                ) : file.type === 'audio' ? (
                  <Music size={12} className="chip-type-icon" />
                ) : (
                  <FileText size={12} className="chip-type-icon" />
                )}
                <span className="chip-filename">{file.name}</span>
                <button
                  type="button"
                  className="chip-remove-btn"
                  onClick={() => handleRemoveFile(file.id)}
                  title="Xóa tệp"
                >
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Ô nhập kịch bản */}
        <div className="copilot-textarea-wrapper">
          <textarea
            ref={textareaRef}
            className="copilot-pure-textarea"
            rows={1}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Hỏi AI Director..."
            disabled={isCanvasLocked || agentStatus === 'running' || agentStatus === 'awaiting_approval'}
          />
        </div>

        {/* Thanh công cụ dưới cùng của composer */}
        <div className="copilot-composer-controls">
          <div className="composer-left-tools">
            <button
              type="button"
              className="composer-ghost-btn"
              onClick={() => fileInputRef.current?.click()}
              title="Đính kèm tệp (+)"
            >
              <Plus size={14} strokeWidth={1.75} />
            </button>

            {/* Model Selector kết nối trực tiếp Settings Store */}
            <div className="composer-model-selector" ref={modelDropdownRef}>
              <button
                type="button"
                className="composer-model-trigger"
                onClick={() => setShowModelDropdown(!showModelDropdown)}
                title="Chọn mô hình AI"
              >
                <span className="model-trigger-text">{activeModelLabel}</span>
                <ChevronDown size={11} className={`model-trigger-chevron ${showModelDropdown ? 'open' : ''}`} />
              </button>

              {showModelDropdown && (
                <div className="composer-model-popup">
                  <div className="model-popup-label">Mô hình AI</div>
                  {DEFAULT_MODELS.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      className={`model-popup-item ${currentModel === m.id ? 'active' : ''}`}
                      onClick={() => handleSelectModel(m.id)}
                    >
                      <span>{m.label}</span>
                      {currentModel === m.id && <CheckCircle size={12} className="model-check-glyph" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="composer-right-tools">
            {agentStatus === 'running' ? (
              <button
                type="button"
                className="composer-round-submit running"
                onClick={handleStop}
                title="Dừng"
              >
                <Square size={11} fill="currentColor" />
              </button>
            ) : (
              <button
                type="button"
                className={`composer-round-submit ${prompt.trim() || attachedFiles.some((f) => f.supported) ? 'ready' : ''}`}
                onClick={() => void handleSend()}
                disabled={(!prompt.trim() && !attachedFiles.some((f) => f.supported)) || isCanvasLocked || agentStatus === 'awaiting_approval'}
                title="Gửi"
              >
                <ArrowRight size={13} strokeWidth={2} />
              </button>
            )}
          </div>
        </div>
      </footer>
    </aside>
  );
}
