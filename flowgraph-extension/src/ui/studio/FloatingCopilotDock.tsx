import React, { useState } from 'react';
import { generateWorkflowFromPrompt } from './CopilotGraphGenerator';
import type { WorkflowTemplate } from './workflowTemplates';
import { Sparkles, ArrowRight, Film, Grid3X3, Layers } from 'lucide-react';

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

  const handleGenerate = (customText?: string) => {
    const textToRun = (customText !== undefined ? customText : prompt).trim();
    if (!textToRun || isCanvasLocked || isProcessing) return;

    setIsProcessing(true);
    setFeedback('AI Director đang thiết lập sơ đồ phân cảnh và nối dây...');

    try {
      const { template, summary } = generateWorkflowFromPrompt(textToRun);
      onApplyTemplate(template);
      setFeedback(summary);

      // Tự động căn góc nhìn sau 300ms
      setTimeout(() => {
        onFitView?.();
        setIsProcessing(false);
      }, 350);

      // Tự tắt thông báo sau 6s
      setTimeout(() => {
        setFeedback(null);
      }, 6000);
    } catch (err: any) {
      setFeedback(`Lỗi: ${err?.message || 'Không thể tạo sơ đồ'}`);
      setIsProcessing(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleGenerate();
    }
  };

  return (
    <div className="floating-copilot-container nodrag nopan">
      {/* Toast Feedback */}
      {feedback && (
        <div className="copilot-feedback-toast" role="status">
          <Sparkles size={14} className="copilot-sparkle-icon" />
          <span>{feedback}</span>
          <button
            type="button"
            className="copilot-toast-close"
            onClick={() => setFeedback(null)}
          >
            ×
          </button>
        </div>
      )}

      {/* Main Capsule Dock */}
      <div className="floating-copilot-dock">
        {/* Preset quick buttons */}
        <div className="copilot-presets">
          <button
            type="button"
            className="copilot-preset-btn"
            onClick={() => {
              const text = 'Phim kịch bản Cửu Cung 9 ô: Linh 17 tuổi cứu mèo con trong mưa đêm Hà Nội, nhận nuôi và cùng chiến thắng hội thi vẽ.';
              setPrompt(text);
              handleGenerate(text);
            }}
            title="Tạo nhanh kịch bản 9 ô theo chuẩn LibTV"
          >
            <Grid3X3 size={13} />
            <span>Cửu Cung 9 Ô</span>
          </button>

          <button
            type="button"
            className="copilot-preset-btn"
            onClick={() => {
              const text = '1. Phi hành gia đáp xuống hành tinh pha lê.\n2. Phát hiện sinh vật ánh sáng kỳ lạ.\n3. Giao tiếp qua sóng âm.\n4. Bay trở về trạm không gian trong bình minh ngân hà.';
              setPrompt(text);
              handleGenerate(text);
            }}
            title="Tạo phim ngắn 4 phân cảnh liên hoàn"
          >
            <Film size={13} />
            <span>Phim 4 Cảnh</span>
          </button>
        </div>

        <div className="copilot-divider" />

        {/* Natural Language Prompt Input */}
        <div className="copilot-input-wrap">
          <Sparkles size={16} className="copilot-input-sparkle" />
          <input
            type="text"
            className="copilot-input"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Bố chỉ cần gõ kịch bản vào đây (AI sẽ tự động chia cảnh và nối dây)..."
            disabled={isCanvasLocked || isProcessing}
          />
        </div>

        {/* Generate / Run Button */}
        <button
          type="button"
          className={`copilot-action-btn ${prompt.trim() ? 'has-input' : ''}`}
          onClick={() => handleGenerate()}
          disabled={!prompt.trim() || isCanvasLocked || isProcessing}
          title="AI Director tự động tạo sơ đồ và nối dây trên Canvas (Enter)"
        >
          {isProcessing ? (
            <span className="copilot-spinner" />
          ) : (
            <>
              <span>Tạo Workflow</span>
              <ArrowRight size={14} />
            </>
          )}
        </button>
      </div>
    </div>
  );
}
