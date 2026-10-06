import type { FlowEdge, FlowNode, FlowNodeData } from '../ui/studio/model';
import { node, paletteSpecForKind } from '../ui/studio/model';
import { nodePortCatalog, portTypesCompatible, type PortDataType } from '../ui/studio/ports';
import { validateGraph, type NodeSpecForValidation, type ValidationReport } from '../runtime/GraphValidator';
import { deriveRegistryConfig } from '../ui/studio/flowModelRegistry';
import { registryModelResolver } from '../runtime/registryModelResolver';
import type { AgentApprovalRequest, AgentTool, SceneSummary } from './types';

export const AGENT_TOOLS: AgentTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_available_nodes',
      description: 'Lấy danh sách tất cả các loại node được hỗ trợ trong FlowGraph Studio, bao gồm cổng vào (inputs), cổng ra (outputs) và các cấu hình mặc định.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_current_graph',
      description: 'Lấy trạng thái hiện tại của canvas gồm tất cả các node và các đường dây nối (edges).',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_node',
      description: 'Thêm một node mới vào canvas với loại node (kind), tiêu đề tùy chỉnh, vị trí và cấu hình ban đầu.',
      parameters: {
        type: 'object',
        properties: {
          kind: {
            type: 'string',
            description: 'Loại node (ví dụ: prompt, gemini, t2i, t2v, i2v, extend, interpolation, reference, videoConcat, storyboardSplit, download, preview, characterCreate).',
          },
          title: {
            type: 'string',
            description: 'Tiêu đề hiển thị của node (ví dụ: "Cảnh 1: Xe chạy trong mưa", "Ghép Video Cuối").',
          },
          x: {
            type: 'number',
            description: 'Tọa độ X trên canvas (tùy chọn, mặc định tự tính).',
          },
          y: {
            type: 'number',
            description: 'Tọa độ Y trên canvas (tùy chọn, mặc định tự tính).',
          },
          config: {
            type: 'object',
            description: 'Cấu hình chi tiết (ví dụ: prompt, model, duration, aspectRatio, promptSource, ...).',
          },
        },
        required: ['kind'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_node_config',
      description: 'Cập nhật tiêu đề hoặc các thông số cấu hình của một node đã có trên canvas.',
      parameters: {
        type: 'object',
        properties: {
          nodeId: {
            type: 'string',
            description: 'ID của node cần cập nhật.',
          },
          title: {
            type: 'string',
            description: 'Tiêu đề mới của node (tùy chọn).',
          },
          config: {
            type: 'object',
            description: 'Các cặp key-value cấu hình cần ghi đè hoặc bổ sung (ví dụ: { prompt: "...", duration: "10 seconds" }).',
          },
        },
        required: ['nodeId', 'config'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'connect_nodes',
      description: 'Nối dây giữa cổng ra (output handle) của node nguồn với cổng vào (input handle) của node đích. Hệ thống sẽ tự kiểm tra tính tương thích dữ liệu giữa hai cổng.',
      parameters: {
        type: 'object',
        properties: {
          sourceNodeId: {
            type: 'string',
            description: 'ID của node nguồn phát dữ liệu.',
          },
          sourceHandle: {
            type: 'string',
            description: 'Tên cổng ra của node nguồn (ví dụ: prompt, image, video, shot1).',
          },
          targetNodeId: {
            type: 'string',
            description: 'ID của node đích nhận dữ liệu.',
          },
          targetHandle: {
            type: 'string',
            description: 'Tên cổng vào của node đích (ví dụ: prompt, image, videos, startImage, endImage).',
          },
        },
        required: ['sourceNodeId', 'sourceHandle', 'targetNodeId', 'targetHandle'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'disconnect_edge',
      description: 'Xóa một đường dây nối cụ thể trên canvas bằng edgeId.',
      parameters: {
        type: 'object',
        properties: {
          edgeId: {
            type: 'string',
            description: 'ID của dây nối cần xóa.',
          },
        },
        required: ['edgeId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'remove_node',
      description: 'Xóa một node khỏi canvas và tự động loại bỏ tất cả các dây nối gắn vào node đó.',
      parameters: {
        type: 'object',
        properties: {
          nodeId: {
            type: 'string',
            description: 'ID của node cần xóa.',
          },
        },
        required: ['nodeId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'clear_canvas',
      description: 'Yêu cầu người dùng xác nhận trước khi xóa sạch tất cả node và dây nối trên canvas để dựng kịch bản hoàn toàn mới.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'auto_layout',
      description: 'Tự động tính toán lại vị trí các node trên canvas theo cấu trúc trực quan thẳng hàng, luồng pipeline hoặc dạng lưới để người dùng dễ nhìn.',
      parameters: {
        type: 'object',
        properties: {
          strategy: {
            type: 'string',
            enum: ['pipeline', 'diamond', 'grid'],
            description: 'Chiến lược dàn trang: pipeline (tuần tự ngang), diamond (phân nhánh ghép), grid (dạng lưới). Mặc định là pipeline.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'validate_graph',
      description: 'Chạy bộ kiểm tra quy tắc đồ thị (GraphValidator) để phát hiện các lỗi kết nối, cổng bắt buộc chưa nối, chu trình khép kín (cycle) hoặc dây nối treo trước khi yêu cầu render.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'request_render_approval',
      description: 'Trình bày tóm tắt kịch bản, các phân cảnh đã dựng và số lượng node/chi phí ước tính để người dùng DUYỆT một lần trước khi kích hoạt render thực tế.',
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'Tên phim hoặc tiêu đề workflow.',
          },
          summary: {
            type: 'string',
            description: 'Đánh giá phân tích của đạo diễn AI về bố cục, nhịp điệu và lý do thiết kế đồ thị.',
          },
          scenes: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                index: { type: 'number' },
                title: { type: 'string' },
                prompt: { type: 'string' },
                model: { type: 'string' },
                duration: { type: 'string' },
              },
              required: ['index', 'title', 'prompt'],
            },
            description: 'Danh sách các phân cảnh trong phim.',
          },
          estimatedCredits: {
            type: 'string',
            description: 'Ước tính số credit hoặc ghi chú chi phí.',
          },
        },
        required: ['title', 'summary', 'scenes'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'trigger_render',
      description: 'Kích hoạt quy trình render các node video/ảnh trên Google Flow runtime. Chỉ gọi sau khi đã validate_graph thành công (0 lỗi) và sau khi đã nhận được duyệt kịch bản (hoặc khi người dùng yêu cầu chạy render ngay).',
      parameters: {
        type: 'object',
        properties: {
          mode: {
            type: 'string',
            enum: ['continue', 'restart'],
            description: "Chế độ chạy: 'continue' (tiếp tục chạy các node chưa có kết quả) hoặc 'restart' (chạy lại toàn bộ kịch bản từ đầu). Mặc định là 'restart'.",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_run_status',
      description: 'Đọc trạng thái thực thi hiện tại của quy trình làm phim: tiến độ các node, trạng thái render trên Google Flow và phản hồi hệ thống.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cancel_render',
      description: 'Dừng hoặc hủy bỏ quy trình render đang chạy trên Google Flow.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
  },
];

export interface ToolExecutionContext {
  getNodes: () => FlowNode[];
  setNodes: (updater: (prev: FlowNode[]) => FlowNode[]) => void;
  getEdges: () => FlowEdge[];
  setEdges: (updater: (prev: FlowEdge[]) => FlowEdge[]) => void;
  getActiveProject: () => { projectId: string } | null;
  onRequestApproval: (request: AgentApprovalRequest) => Promise<boolean>;
  /** Called once by the UI before the first graph mutation in an Agent run. */
  onBeforeGraphMutation?: (kind: string) => void;
  onRunWorkflow?: (mode?: 'continue' | 'restart') => void;
  getRunStatus?: () => string;
  getRunFeedback?: () => string;
  onCancelRun?: () => void;
}

export class FlowGraphAgentToolRunner {
  private ctx: ToolExecutionContext;
  private nextNodeIdCounter = 1;

  constructor(ctx: ToolExecutionContext) {
    this.ctx = ctx;
    // Đồng bộ counter ID để không trùng lặp
    const currentNodes = ctx.getNodes();
    for (const n of currentNodes) {
      const num = parseInt(n.id, 10);
      if (!isNaN(num) && num >= this.nextNodeIdCounter) {
        this.nextNodeIdCounter = num + 1;
      }
    }
  }

  public async executeTool(name: string, args: Record<string, any>): Promise<any> {
    switch (name) {
      case 'get_available_nodes':
        return this.toolGetAvailableNodes();
      case 'get_current_graph':
        return this.toolGetCurrentGraph();
      case 'add_node':
        return this.toolAddNode(args as any);
      case 'update_node_config':
        return this.toolUpdateNodeConfig(args as any);
      case 'connect_nodes':
        return this.toolConnectNodes(args as any);
      case 'disconnect_edge':
        return this.toolDisconnectEdge(args as any);
      case 'remove_node':
        return this.toolRemoveNode(args as any);
      case 'clear_canvas':
        return this.toolClearCanvas();
      case 'auto_layout':
        return this.toolAutoLayout(args?.strategy);
      case 'validate_graph':
        return this.toolValidateGraph();
      case 'request_render_approval':
        return this.toolRequestRenderApproval(args as any);
      case 'trigger_render':
        return this.toolTriggerRender(args as any);
      case 'get_run_status':
        return this.toolGetRunStatus();
      case 'cancel_render':
        return this.toolCancelRender();
      default:
        throw new Error(`Công cụ không xác định: ${name}`);
    }
  }

  private toolGetAvailableNodes(): any {
    const list: any[] = [];
    for (const [kind, spec] of Object.entries(nodePortCatalog)) {
      const palette = paletteSpecForKind(kind);
      list.push({
        kind,
        title: palette?.title || kind,
        subtitle: palette?.subtitle || '',
        group: palette?.group || 'Utility',
        inputs: spec.inputs.map((p) => ({
          id: p.id,
          label: p.label,
          type: p.type,
          required: Boolean(p.required),
          multiple: Boolean(p.multiple),
          configKey: p.configKey,
        })),
        outputs: spec.outputs.map((p) => ({
          id: p.id,
          label: p.label,
          type: p.type,
        })),
        defaultConfig: palette?.config || {},
      });
    }
    return {
      availableNodes: list,
      totalKinds: list.length,
      note: 'Dùng t2v (Text to Video) hoặc i2v (Image to Video) để sinh cảnh, dùng videoConcat để ghép nối chuỗi video.',
    };
  }

  private toolGetCurrentGraph(): any {
    const nodes = this.ctx.getNodes().map((n) => ({
      id: n.id,
      kind: n.data.kind,
      title: n.data.title,
      position: n.position,
      config: n.data.config,
      status: n.data.status,
    }));
    const edges = this.ctx.getEdges().map((e) => ({
      id: e.id,
      source: e.source,
      sourceHandle: e.sourceHandle,
      target: e.target,
      targetHandle: e.targetHandle,
    }));
    return {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      nodes,
      edges,
    };
  }

  private toolAddNode(args: {
    kind: string;
    title?: string;
    x?: number;
    y?: number;
    config?: Record<string, string>;
  }): any {
    const kind = args.kind;
    const spec = paletteSpecForKind(kind);
    if (!spec) {
      throw new Error(`Loại node "${kind}" không tồn tại trong hệ thống.`);
    }

    const currentNodes = this.ctx.getNodes();
    const id = String(this.nextNodeIdCounter++);

    let x = args.x;
    let y = args.y;
    if (x === undefined || y === undefined) {
      // Tự động tính toán vị trí nối tiếp
      const count = currentNodes.length;
      x = 80 + (count % 4) * 320;
      y = 120 + Math.floor(count / 4) * 260;
    }

    const extra: Partial<FlowNodeData> = {};
    if (args.title) extra.title = args.title;
    if (args.config) extra.config = args.config;

    const newNode = node(id, kind, x, y, extra);
    this.ctx.onBeforeGraphMutation?.('add_node');
    this.ctx.setNodes((prev) => [...prev, newNode]);

    return {
      success: true,
      node: {
        id: newNode.id,
        kind: newNode.data.kind,
        title: newNode.data.title,
        position: newNode.position,
        config: newNode.data.config,
      },
    };
  }

  private toolUpdateNodeConfig(args: {
    nodeId: string;
    title?: string;
    config: Record<string, string>;
  }): any {
    const currentNodes = this.ctx.getNodes();
    const target = currentNodes.find((n) => n.id === args.nodeId);
    if (!target) {
      throw new Error(`Không tìm thấy node có ID "${args.nodeId}".`);
    }

    const updatedConfig = deriveRegistryConfig(target.data.kind, {
      ...target.data.config,
      ...args.config,
    });

    this.ctx.onBeforeGraphMutation?.('update_node_config');
    this.ctx.setNodes((prev) =>
      prev.map((n) => {
        if (n.id !== args.nodeId) return n;
        return {
          ...n,
          data: {
            ...n.data,
            title: args.title || n.data.title,
            config: updatedConfig,
          },
        };
      })
    );

    return {
      success: true,
      nodeId: args.nodeId,
      updatedConfig,
    };
  }

  private toolConnectNodes(args: {
    sourceNodeId: string;
    sourceHandle: string;
    targetNodeId: string;
    targetHandle: string;
  }): any {
    const nodes = this.ctx.getNodes();
    const sourceNode = nodes.find((n) => n.id === args.sourceNodeId);
    const targetNode = nodes.find((n) => n.id === args.targetNodeId);

    if (!sourceNode) throw new Error(`Node nguồn ID "${args.sourceNodeId}" không tồn tại.`);
    if (!targetNode) throw new Error(`Node đích ID "${args.targetNodeId}" không tồn tại.`);

    const sourceSpec = nodePortCatalog[sourceNode.data.kind];
    const targetSpec = nodePortCatalog[targetNode.data.kind];

    if (!sourceSpec) throw new Error(`Không tìm thấy cấu hình cổng cho loại node "${sourceNode.data.kind}".`);
    if (!targetSpec) throw new Error(`Không tìm thấy cấu hình cổng cho loại node "${targetNode.data.kind}".`);

    const sourcePort = sourceSpec.outputs.find((p) => p.id === args.sourceHandle);
    const targetPort = targetSpec.inputs.find((p) => p.id === args.targetHandle);

    if (!sourcePort) {
      throw new Error(`Cổng ra "${args.sourceHandle}" không có trên node "${sourceNode.data.title}" (${sourceNode.data.kind}). Các cổng ra hợp lệ: ${sourceSpec.outputs.map((p) => p.id).join(', ')}`);
    }
    if (!targetPort) {
      throw new Error(`Cổng vào "${args.targetHandle}" không có trên node "${targetNode.data.title}" (${targetNode.data.kind}). Các cổng vào hợp lệ: ${targetSpec.inputs.map((p) => p.id).join(', ')}`);
    }

    if (!portTypesCompatible(sourcePort.type, targetPort.type)) {
      throw new Error(`Không tương thích kiểu dữ liệu: Cổng ra "${args.sourceHandle}" (${sourcePort.type}) không thể nối vào cổng vào "${args.targetHandle}" (${targetPort.type}).`);
    }

    const strokeColor =
      sourcePort.type === 'PROMPT'
        ? '#9a52f8'
        : sourcePort.type === 'IMAGE'
        ? '#4e9fff'
        : sourcePort.type === 'VIDEO'
        ? '#3ad39c'
        : '#888888';

    const edgeId = `e_${args.sourceNodeId}_${args.sourceHandle}__${args.targetNodeId}_${args.targetHandle}`;

    const newEdge: FlowEdge = {
      id: edgeId,
      source: args.sourceNodeId,
      sourceHandle: args.sourceHandle,
      target: args.targetNodeId,
      targetHandle: args.targetHandle,
      type: 'default',
      animated: false,
      style: { stroke: strokeColor },
    };

    this.ctx.onBeforeGraphMutation?.('connect_nodes');
    this.ctx.setEdges((prev) => {
      const filtered = prev.filter((e) => e.id !== edgeId);
      return [...filtered, newEdge];
    });

    return {
      success: true,
      edge: newEdge,
    };
  }

  private toolDisconnectEdge(args: { edgeId: string }): any {
    this.ctx.onBeforeGraphMutation?.('disconnect_edge');
    this.ctx.setEdges((prev) => prev.filter((e) => e.id !== args.edgeId));
    return { success: true, removedEdgeId: args.edgeId };
  }

  private toolRemoveNode(args: { nodeId: string }): any {
    this.ctx.onBeforeGraphMutation?.('remove_node');
    this.ctx.setNodes((prev) => prev.filter((n) => n.id !== args.nodeId));
    this.ctx.setEdges((prev) => prev.filter((e) => e.source !== args.nodeId && e.target !== args.nodeId));
    return { success: true, removedNodeId: args.nodeId };
  }

  private async toolClearCanvas(): Promise<any> {
    const nodes = this.ctx.getNodes();
    const edges = this.ctx.getEdges();

    if (nodes.length === 0 && edges.length === 0) {
      return {
        success: true,
        changed: false,
        message: 'Canvas đã trống, không có gì cần xóa.',
        removedNodeCount: 0,
        removedEdgeCount: 0,
      };
    }

    if (!this.ctx.onRequestApproval) {
      return {
        success: false,
        requiresApproval: true,
        message: 'Cần người dùng xác nhận trước khi làm trống canvas.',
      };
    }

    const approved = await this.ctx.onRequestApproval({
      id: `mutation_${Date.now()}`,
      kind: 'destructive',
      title: 'Làm trống canvas?',
      summary: `Thao tác này sẽ xóa ${nodes.length} node và ${edges.length} đường nối khỏi canvas hiện tại. Bạn vẫn có thể hoàn tác sau khi xác nhận.`,
      scenes: [],
      nodeCount: nodes.length,
      edgeCount: edges.length,
      graphSnapshot: { nodes, edges },
    });

    if (!approved) {
      return {
        success: false,
        cancelled: true,
        message: 'Đã giữ nguyên canvas theo yêu cầu của người dùng.',
        removedNodeCount: 0,
        removedEdgeCount: 0,
      };
    }

    this.ctx.onBeforeGraphMutation?.('clear_canvas');
    this.ctx.setNodes(() => []);
    this.ctx.setEdges(() => []);
    this.nextNodeIdCounter = 1;
    return {
      success: true,
      changed: true,
      message: 'Canvas đã được làm trống.',
      removedNodeCount: nodes.length,
      removedEdgeCount: edges.length,
    };
  }

  private toolAutoLayout(strategy: string = 'pipeline'): any {
    const nodes = this.ctx.getNodes();
    const edges = this.ctx.getEdges();

    // Sắp xếp phân tầng theo Topological Sort đơn giản
    const inDegree: Record<string, number> = {};
    const adj: Record<string, string[]> = {};
    for (const n of nodes) {
      inDegree[n.id] = 0;
      adj[n.id] = [];
    }
    for (const e of edges) {
      if (adj[e.source]) adj[e.source].push(e.target);
      if (inDegree[e.target] !== undefined) inDegree[e.target]++;
    }

    const layers: string[][] = [];
    let currentLayer = nodes.filter((n) => inDegree[n.id] === 0).map((n) => n.id);
    const visited = new Set<string>();

    while (currentLayer.length > 0) {
      layers.push(currentLayer);
      currentLayer.forEach((id) => visited.add(id));
      const nextLayer: string[] = [];
      for (const id of currentLayer) {
        for (const neighbor of adj[id] || []) {
          inDegree[neighbor]--;
          if (inDegree[neighbor] === 0 && !visited.has(neighbor)) {
            nextLayer.push(neighbor);
          }
        }
      }
      currentLayer = nextLayer;
    }

    // Các node mồ côi hoặc trong chu trình nếu còn sót
    const remaining = nodes.filter((n) => !visited.has(n.id)).map((n) => n.id);
    if (remaining.length > 0) {
      layers.push(remaining);
    }

    const positions: Record<string, { x: number; y: number }> = {};
    const X_GAP = 360;
    const Y_GAP = 280;
    const START_X = 80;
    const START_Y = 120;

    layers.forEach((layerNodeIds, layerIdx) => {
      layerNodeIds.forEach((nodeId, nodeIdxInLayer) => {
        const x = START_X + layerIdx * X_GAP;
        const y = START_Y + nodeIdxInLayer * Y_GAP;
        positions[nodeId] = { x, y };
      });
    });

    this.ctx.onBeforeGraphMutation?.('auto_layout');
    this.ctx.setNodes((prev) =>
      prev.map((n) => {
        const p = positions[n.id];
        return p ? { ...n, position: p } : n;
      })
    );

    return {
      success: true,
      strategy,
      layersCount: layers.length,
      nodePositions: positions,
    };
  }

  private toolValidateGraph(): ValidationReport {
    const nodes = this.ctx.getNodes();
    const edges = this.ctx.getEdges();
    const activeProject = this.ctx.getActiveProject();

    const nodeSpecs: NodeSpecForValidation[] = nodes.map((n) => {
      const portSpec = nodePortCatalog[n.data.kind] || { inputs: [], outputs: [] };
      const canonicalConfig = deriveRegistryConfig(n.data.kind, n.data.config || {});
      return {
        id: n.id,
        kind: n.data.kind,
        inputs: portSpec.inputs,
        outputs: portSpec.outputs,
        config: canonicalConfig,
      };
    });

    return validateGraph(nodeSpecs, edges, {
      activeProject: activeProject || { projectId: 'preview-project' },
      modelResolver: registryModelResolver,
    });
  }

  private async toolRequestRenderApproval(args: {
    title: string;
    summary: string;
    scenes: SceneSummary[];
    estimatedCredits?: string;
  }): Promise<any> {
    const nodes = this.ctx.getNodes();
    const edges = this.ctx.getEdges();

    const approvalRequest: AgentApprovalRequest = {
      id: `apr_${Date.now()}`,
      kind: 'render',
      title: args.title,
      summary: args.summary,
      scenes: args.scenes,
      nodeCount: nodes.length,
      edgeCount: edges.length,
      estimatedCredits: args.estimatedCredits || `${nodes.length * 15} credits`,
      graphSnapshot: { nodes, edges },
    };

    const isApproved = await this.ctx.onRequestApproval(approvalRequest);

    return {
      approvalCompleted: true,
      approved: isApproved,
      message: isApproved
        ? 'Người dùng ĐÃ DUYỆT kịch bản và đồ thị! Bạn có thể gọi tool "trigger_render" ngay để bắt đầu render.'
        : 'Người dùng KHÔNG DUYỆT hoặc yêu cầu điều chỉnh kịch bản. Hãy hỏi rõ người dùng muốn thay đổi điều gì.',
    };
  }

  private async toolTriggerRender(args?: { mode?: 'continue' | 'restart' }): Promise<any> {
    const report = this.toolValidateGraph();
    if (!report.valid) {
      const errMsgs = report.errors.map((e) => e.message).join('; ');
      throw new Error(`Không thể kích hoạt render vì đồ thị còn lỗi cấu hình: ${errMsgs}`);
    }

    if (!this.ctx.onRunWorkflow) {
      throw new Error('Runtime chưa cung cấp hàm kích hoạt render trực tiếp (onRunWorkflow).');
    }

    const mode = args?.mode || 'restart';
    this.ctx.onRunWorkflow(mode);

    return {
      success: true,
      message: `Đã kích hoạt render đồ thị trên Google Flow ở chế độ "${mode}". Quy trình bắt đầu thực thi.`,
      mode,
      status: this.ctx.getRunStatus?.() || 'running',
    };
  }

  private toolGetRunStatus(): any {
    const status = this.ctx.getRunStatus?.() || 'idle';
    const feedback = this.ctx.getRunFeedback?.() || '';
    const nodes = this.ctx.getNodes();
    const stats = {
      total: nodes.length,
      idle: nodes.filter((n) => !n.data.status || n.data.status === 'idle').length,
      running: nodes.filter((n) => n.data.status === 'running').length,
      success: nodes.filter((n) => n.data.status === 'success').length,
      error: nodes.filter((n) => n.data.status === 'failed').length,
    };
    return {
      status,
      feedback,
      stats,
    };
  }

  private toolCancelRender(): any {
    if (this.ctx.onCancelRun) {
      this.ctx.onCancelRun();
      return { success: true, message: 'Đã gửi lệnh hủy tiến trình render tới Google Flow.' };
    }
    return { success: false, message: 'Bộ hủy render chưa được kết nối.' };
  }
}
