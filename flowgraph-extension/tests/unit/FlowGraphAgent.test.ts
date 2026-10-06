import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FlowGraphAgentToolRunner } from '../../src/agent/FlowGraphAgentTools';
import { AgentClient } from '../../src/agent/AgentClient';
import { FlowGraphAgent } from '../../src/agent/FlowGraphAgent';
import type { FlowNode, FlowEdge } from '../../src/ui/studio/model';
import { node } from '../../src/ui/studio/model';

class MockStorage {
  private values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  clear() {
    this.values.clear();
  }
}

describe('FlowGraph Agent System — Real Toolset & Architecture', () => {
  let mockNodes: FlowNode[];
  let mockEdges: FlowEdge[];
  let mockActiveProject: { projectId: string } | null;

  beforeEach(() => {
    (globalThis as any).localStorage = new MockStorage();
    mockNodes = [
      node('1', 'prompt', 80, 120, { config: { prompt: 'A sleek cyberpunk car' } }),
    ];
    mockEdges = [];
    mockActiveProject = { projectId: 'test-project-123' };
  });

  const createTestContext = (approvalResult = true) => {
    return {
      getNodes: () => mockNodes,
      setNodes: (updater: (prev: FlowNode[]) => FlowNode[]) => {
        mockNodes = updater(mockNodes);
      },
      getEdges: () => mockEdges,
      setEdges: (updater: (prev: FlowEdge[]) => FlowEdge[]) => {
        mockEdges = updater(mockEdges);
      },
      getActiveProject: () => mockActiveProject,
      onRequestApproval: vi.fn().mockResolvedValue(approvalResult),
    };
  };

  it('1. get_available_nodes trả về danh mục node đầy đủ và đúng cổng', async () => {
    const ctx = createTestContext();
    const runner = new FlowGraphAgentToolRunner(ctx);

    const result = await runner.executeTool('get_available_nodes', {});
    expect(result.availableNodes).toBeDefined();
    expect(result.availableNodes.length).toBeGreaterThan(10);

    const t2vSpec = result.availableNodes.find((n: any) => n.kind === 't2v');
    expect(t2vSpec).toBeDefined();
    expect(t2vSpec.title).toBe('Text to Video');
    expect(t2vSpec.inputs.some((p: any) => p.id === 'prompt')).toBe(true);
    expect(t2vSpec.outputs.some((p: any) => p.id === 'video')).toBe(true);
  });

  it('2. add_node tạo đúng FlowNode với dữ liệu chuẩn và cập nhật canvas', async () => {
    const ctx = createTestContext();
    const runner = new FlowGraphAgentToolRunner(ctx);

    const res = await runner.executeTool('add_node', {
      kind: 't2v',
      title: 'Cảnh 1: Xe chạy ban đêm',
      config: {
        model: 'Omni 1.1 Flash',
        duration: '8 seconds',
        aspectRatio: '16:9',
      },
    });

    expect(res.success).toBe(true);
    expect(res.node.kind).toBe('t2v');
    expect(res.node.title).toBe('Cảnh 1: Xe chạy ban đêm');
    expect(mockNodes.length).toBe(2);
    expect(mockNodes[1].data.config.duration).toBe('8 seconds');
  });

  it('3. connect_nodes nối đúng cổng tương thích và từ chối cổng không tương thích', async () => {
    const ctx = createTestContext();
    const runner = new FlowGraphAgentToolRunner(ctx);

    // Thêm t2v node
    await runner.executeTool('add_node', { kind: 't2v', title: 'Video Node' });
    const t2vId = mockNodes[1].id;

    // Nối hợp lệ: Prompt (PROMPT) -> t2v (prompt)
    const validConnect = await runner.executeTool('connect_nodes', {
      sourceNodeId: '1',
      sourceHandle: 'prompt',
      targetNodeId: t2vId,
      targetHandle: 'prompt',
    });
    expect(validConnect.success).toBe(true);
    expect(mockEdges.length).toBe(1);

    // Nối không hợp lệ: t2v (video: VIDEO) -> t2i (prompt: PROMPT) -> Bị từ chối vì sai kiểu
    await runner.executeTool('add_node', { kind: 't2i', title: 'Image Node' });
    const t2iId = mockNodes[2].id;
    await expect(
      runner.executeTool('connect_nodes', {
        sourceNodeId: t2vId,
        sourceHandle: 'video',
        targetNodeId: t2iId,
        targetHandle: 'prompt',
      })
    ).rejects.toThrow(/Không tương thích kiểu dữ liệu/);
  });

  it('4. update_node_config và auto_layout cập nhật chuẩn xác', async () => {
    const ctx = createTestContext();
    const runner = new FlowGraphAgentToolRunner(ctx);

    await runner.executeTool('update_node_config', {
      nodeId: '1',
      title: 'Prompt Đã Tinh Chỉnh',
      config: { prompt: 'A hypercar speeding through neon rain' },
    });

    expect(mockNodes[0].data.title).toBe('Prompt Đã Tinh Chỉnh');
    expect(mockNodes[0].data.config.prompt).toBe('A hypercar speeding through neon rain');

    const layoutRes = await runner.executeTool('auto_layout', { strategy: 'pipeline' });
    expect(layoutRes.success).toBe(true);
    expect(layoutRes.nodePositions['1']).toBeDefined();
  });

  it('5. validate_graph phát hiện lỗi cổng bắt buộc chưa nối', async () => {
    const ctx = createTestContext();
    const runner = new FlowGraphAgentToolRunner(ctx);

    // Thêm node i2v (yêu cầu image và prompt) nhưng không nối gì
    await runner.executeTool('add_node', { kind: 'i2v', title: 'Image to Video' });
    await runner.executeTool('add_node', { kind: 'download', title: 'Download' });

    // Nối i2v -> download
    const i2vId = mockNodes[1].id;
    const dlId = mockNodes[2].id;
    await runner.executeTool('connect_nodes', {
      sourceNodeId: i2vId,
      sourceHandle: 'video',
      targetNodeId: dlId,
      targetHandle: 'media',
    });

    const report = await runner.executeTool('validate_graph', {});
    expect(report.valid).toBe(false);
    expect(report.errors.some((e: any) => e.code === 'MISSING_REQUIRED_INPUT')).toBe(true);
  });

  it('6. request_render_approval kích hoạt cổng duyệt của người dùng', async () => {
    const ctx = createTestContext(true);
    const runner = new FlowGraphAgentToolRunner(ctx);

    const approvalRes = await runner.executeTool('request_render_approval', {
      title: 'Phim Ngắn Cyberpunk',
      summary: 'Kịch bản gồm 2 cảnh xe chạy và ghép lại thành 1 video mượt mà.',
      scenes: [
        { index: 1, title: 'Cảnh 1: Xuất phát', prompt: 'Car leaving garage' },
        { index: 2, title: 'Cảnh 2: Tăng tốc', prompt: 'Car accelerating on highway' },
      ],
      estimatedCredits: '30 credits',
    });

    expect(approvalRes.approvalCompleted).toBe(true);
    expect(approvalRes.approved).toBe(true);
    expect(ctx.onRequestApproval).toHaveBeenCalledTimes(1);
    expect(ctx.onRequestApproval.mock.calls[0][0].title).toBe('Phim Ngắn Cyberpunk');
  });

  it('7. clear_canvas phải được xác nhận và tạo mốc Undo trước khi xóa', async () => {
    const ctx = createTestContext(true) as ReturnType<typeof createTestContext> & {
      onBeforeGraphMutation?: (kind: string) => void;
    };
    const onBeforeGraphMutation = vi.fn();
    ctx.onBeforeGraphMutation = onBeforeGraphMutation;
    const runner = new FlowGraphAgentToolRunner(ctx);

    const result = await runner.executeTool('clear_canvas', {});

    expect(result.success).toBe(true);
    expect(result.removedNodeCount).toBe(1);
    expect(result.removedEdgeCount).toBe(0);
    expect(mockNodes).toHaveLength(0);
    expect(mockEdges).toHaveLength(0);
    expect(onBeforeGraphMutation).toHaveBeenCalledWith('clear_canvas');
    expect(ctx.onRequestApproval).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'destructive',
      nodeCount: 1,
      edgeCount: 0,
    }));
  });

  it('8. từ chối clear_canvas giữ nguyên canvas', async () => {
    const ctx = createTestContext(false);
    const runner = new FlowGraphAgentToolRunner(ctx);

    const result = await runner.executeTool('clear_canvas', {});

    expect(result.success).toBe(false);
    expect(result.cancelled).toBe(true);
    expect(mockNodes).toHaveLength(1);
  });

  it('9. AgentClient đọc cấu hình từ localStorage và xử lý fallback model', () => {
    localStorage.setItem(
      'flowgraph.settings.v1',
      JSON.stringify({
        aiGatewayUrl: 'http://localhost:20128/v1',
        aiApiKey: 'Thangterter',
        aiModel: 'cx/gpt-5.6-luna',
      })
    );

    const client = new AgentClient();
    const cfg = client.getConfig();
    expect(cfg.baseUrl).toBe('http://localhost:20128/v1');
    expect(cfg.model).toBe('cx/gpt-5.6-luna');
    expect(cfg.hasToken).toBe(true);
  });

  it('10. FlowGraphAgent quản lý vòng lặp và AbortSignal chuẩn', async () => {
    const ctx = createTestContext();
    const onStep = vi.fn();
    const onStatusChange = vi.fn();

    const agent = new FlowGraphAgent(ctx, { onStep, onStatusChange });
    expect(agent.getStatus()).toBe('idle');

    // Mock client chat để kiểm tra abort
    const abortPromise = agent.runPrompt('Tạo một video xe chạy');
    agent.abort();

    const res = await abortPromise;
    expect(res.success).toBe(false);
    expect(agent.getStatus()).toBe('aborted');
  });

  it('11. trigger_render, get_run_status, cancel_render điều khiển quy trình render thật sự', async () => {
    const onRunWorkflow = vi.fn();
    const onCancelRun = vi.fn();
    let currentRunStatus = 'ready';

    const ctx = {
      ...createTestContext(),
      onRunWorkflow,
      onCancelRun,
      getRunStatus: () => currentRunStatus,
      getRunFeedback: () => 'Đang tiến hành chuẩn bị tài nguyên...',
    };

    const runner = new FlowGraphAgentToolRunner(ctx);

    // 1. Kiểm tra get_run_status
    const statusBefore = await runner.executeTool('get_run_status', {});
    expect(statusBefore.status).toBe('ready');
    expect(statusBefore.feedback).toBe('Đang tiến hành chuẩn bị tài nguyên...');
    expect(statusBefore.stats.total).toBe(1);

    // 2. Kích hoạt render
    const renderRes = await runner.executeTool('trigger_render', { mode: 'restart' });
    expect(renderRes.success).toBe(true);
    expect(onRunWorkflow).toHaveBeenCalledWith('restart');

    // 3. Hủy render
    const cancelRes = await runner.executeTool('cancel_render', {});
    expect(cancelRes.success).toBe(true);
    expect(onCancelRun).toHaveBeenCalledTimes(1);
  });
});
