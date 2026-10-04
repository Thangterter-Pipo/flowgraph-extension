import React, { useState } from 'react';
import { generateWorkflowFromPrompt } from './CopilotGraphGenerator';
import type { WorkflowTemplate } from './workflowTemplates';
import { Bot, Send, Sparkles, X } from 'lucide-react';

interface FloatingCopilotDockProps {
  onApplyTemplate: (template: WorkflowTemplate) => void;
  onFitView?: () => void;
  isCanvasLocked?: boolean;
}

export function FloatingCopilotDock({
  onApplyTemplate,
  onFitView,
  isCanvasLocked,
}: FloatingCopilotDockProps) {
  const [prompt, setPrompt] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const handleSend = async () => {
    const textToRun = prompt.trim();
    if (!textToRun || isCanvasLocked || isProcessing) return;

    setIsProcessing(true);
    setFeedback('AI Director đang đọc kịch bản & phân tích bố cục phân cảnh...');

    try {
      const { template, summary } = await generateWorkflowFromPrompt(textToRun);
      onApplyTemplate(template);
      setFeedback(summary);

      // Tự động căn góc nhìn sau khi node commit
      setTimeout(() => {
        onFitView?.();
        setIsProcessing(false);
      }, 400);

      // Tự tắt thông báo sau 8s
      setTimeout(() => {
        setFeedback(null);
      }, 8000);
    } catch (err: any) {
      setFeedback(`Lỗi: ${err?.message || 'Không thể tạo sơ đồ'}`);
      setIsProcessing(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void handleSend();
    }
  };

  return (
    <div className="floating-copilot-container nodrag nopan">
      {/* Toast Feedback từ AI Director */}
      {feedback && (
        <div className="copilot-feedback-toast" role="status">
          <Sparkles size={14} className="copilot-sparkle-icon" />
          <span>{feedback}</span>
          <button
            type="button"
            className="copilot-toast-close"
            onClick={() => setFeedback(null)}
            title="Đóng thông báo"
          >
            <X size={13} />
          </button>
        </div>
      )}

      {/* Main AI Chat Dock (Không có preset cứng nhắc, thuần túy Chat AI) */}
      <div className="floating-copilot-dock">
        {/* Badge nhận diện AI Director */}
        <div className="copilot-ai-badge">
          <Bot size={15} />
          <span>AI Director</span>
        </div>

        <div className="copilot-divider" />

        {/* Ô nhập chat AI */}
        <div className="copilot-input-wrap">
          <input
            type="text"
            className="copilot-input"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Gõ bất kỳ ý tưởng kịch bản nào (AI sẽ tự động đọc hiểu, chia cảnh và nối dây)..."
            disabled={isCanvasLocked || isProcessing}
          />
        </div>

        {/* Nút gửi lệnh tới AI */}
        <button
          type="button"
          className={`copilot-action-btn ${prompt.trim() ? 'has-input' : ''}`}
          onClick={() => void handleSend()}
          disabled={!prompt.trim() || isCanvasLocked || isProcessing}
          title="Gửi lệnh cho AI Director tạo sơ đồ phim (Enter)"
        >
          {isProcessing ? (
            <span className="copilot-spinner" />
          ) : (
            <>
              <span>Tạo Phim</span>
              <Send size={13} />
            </>
          )}
        </button>
      </div>
    </div>
  );
}
