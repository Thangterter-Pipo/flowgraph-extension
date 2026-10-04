import { describe, it, expect } from 'vitest';
import { parseCopilotPrompt, generateWorkflowFromPrompt } from '../../src/ui/studio/CopilotGraphGenerator';
import { validateGraph } from '../../src/runtime/GraphValidator';
import { supportedKinds } from '../../src/runtime/executors';
import { registryModelResolver } from '../../src/runtime/registryModelResolver';

describe('CopilotGraphGenerator - AI Director Engine', () => {
  it('phân tích chính xác prompt có từ khóa Cửu Cung 9 Ô', () => {
    const raw = 'Phim kịch bản Cửu Cung 9 ô: Linh 17 tuổi cứu mèo con trong mưa đêm Hà Nội, nhận nuôi và cùng chiến thắng hội thi vẽ.';
    const parsed = parseCopilotPrompt(raw);
    expect(parsed.strategy).toBe('STORYBOARD_9GRID');
    expect(parsed.scenes.length).toBe(9);
  });

  it('phân tích chính xác format kịch bản đánh số nhiều cảnh (Multi-Scene)', () => {
    const raw = `
    Kịch bản phim: Thám tử mèo
    1. Thám tử mèo phát hiện dấu chân bí ẩn trong thư viện.
    2. Chạy theo vệt sáng ra sân sau.
    3. Tìm thấy quyển sách cổ bị đánh cắp dưới gốc cây sồi.
    4. Mỉm cười đắc thắng dưới ánh trăng rằm.
    `;
    const parsed = parseCopilotPrompt(raw);
    expect(parsed.strategy).toBe('MULTI_SCENE');
    expect(parsed.scenes.length).toBe(4);
    expect(parsed.scenes[0].prompt).toContain('Thám tử mèo phát hiện');
    expect(parsed.scenes[3].prompt).toContain('Mỉm cười đắc thắng');
  });

  it('phân tích chính xác format kịch bản gạch đầu dòng (- hoặc *)', () => {
    const raw = `
    - Phi hành gia đáp xuống sao Hỏa
    - Gặp bão cát màu tím khổng lồ
    - Tìm thấy hang động pha lê phát sáng
    `;
    const parsed = parseCopilotPrompt(raw);
    expect(parsed.strategy).toBe('MULTI_SCENE');
    expect(parsed.scenes.length).toBe(3);
    expect(parsed.scenes[1].prompt).toContain('bão cát màu tím');
  });

  it('phân tích prompt tự do 1 câu thành quy trình Video Đơn Lẻ (Single Shot)', () => {
    const raw = 'Một cô gái tóc ngắn mặc áo mưa vàng đạp xe qua cánh đồng hoa hướng dương.';
    const parsed = parseCopilotPrompt(raw);
    expect(parsed.strategy).toBe('SINGLE_SHOT');
    expect(parsed.scenes.length).toBe(1);
  });

  it('tạo đồ thị Cửu Cung 9 Ô hoàn chỉnh với đầy đủ các liên kết hợp lệ', () => {
    const { template, summary } = generateWorkflowFromPrompt('Cửu cung 9 ô hành trình Linh và mèo Mít');
    expect(template.nodes.length).toBeGreaterThanOrEqual(8);
    expect(template.edges.length).toBeGreaterThanOrEqual(7);
    expect(summary).toContain('Cửu Cung 9 Ô');

    // Kiểm tra tính hợp lệ của đồ thị qua GraphValidator
    const validationNodes = template.nodes.map((n) => ({
      id: n.id,
      kind: n.data.kind,
      config: n.data.config || {},
      inputs: [],
      outputs: [],
    }));
    const validationEdges = template.edges.map((e) => ({
      ...e,
      sourceHandle: e.sourceHandle || undefined,
      targetHandle: e.targetHandle || undefined,
    }));

    const report = validateGraph(validationNodes, validationEdges, {
      activeProject: { projectId: 'test-proj' } as any,
      supportedKinds,
      modelResolver: registryModelResolver,
    });

    // Không có chu trình vòng lặp (CYCLE_DETECTED) hay cạnh rơi tự do (DANGLING_EDGE)
    const fatalErrors = report.errors.filter((e) => ['CYCLE_DETECTED', 'DANGLING_EDGE'].includes(e.code));
    expect(fatalErrors).toHaveLength(0);
  });

  it('tạo đồ thị Multi-Scene tuần tự và kiểm tra kết nối Stitch Timeline', () => {
    const raw = `
    Cảnh 1: Con tàu vũ trụ xuất phát
    Cảnh 2: Bay qua vành đai sao Thổ
    Cảnh 3: Tiến vào lỗ sâu không gian
    `;
    const { template, summary } = generateWorkflowFromPrompt(raw);
    expect(template.nodes.some((n) => n.id === 'cp-stitch-timeline')).toBe(true);
    expect(template.nodes.some((n) => n.id === 'cp-final-film')).toBe(true);
    expect(summary).toContain('3 phân cảnh tuần tự');
  });
});
