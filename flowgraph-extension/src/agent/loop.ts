/**
 * ReAct Agent Loop for FlowGraph Studio AI Director.
 *
 * Drives RuntimeApi through structured tool calling:
 *   Plan / Split -> Build Graph -> Propose Render -> Await Approval -> Submit Render -> Monitor
 *
 * Invariants enforced:
 *   - Bounded execution (maxTurns to prevent runaway loops)
 *   - Video scenes strictly <= 8 seconds (split into multiple scenes + videoConcat)
 *   - No unapproved renders (compiler-backed gate via RuntimeApi.submitRender requiring token)
 *   - Non-blocking error recovery (ApiResult handling without crashing)
 */

import type { RuntimeApi, CreateNodeInput, UpdateNodePatch, ConnectEdgeInput, NodeKind, EdgeKind } from '../shared/bridge-types';
import type { RenderPlan, SceneSpec, NodeType } from '../shared/approval-types';
import { MAX_VIDEO_SECONDS, MAX_PROMPT_CHARS, canConnect, NODE_PORTS } from '../shared/graph-rules';
import { canonicalJson } from '../shared/canonical-json';
import { AgentClient } from './AgentClient';
import type { AgentMessage, AgentTool, AgentStep, ToolCall } from './types';

export interface AgentLoopOptions {
  maxTurns?: number;
  systemPrompt?: string;
  client?: AgentClient;
  customLlm?: (messages: AgentMessage[], tools: AgentTool[], signal?: AbortSignal) => Promise<AgentMessage>;
  signal?: AbortSignal;
  onStep?: (step: AgentStep) => void;
  onTurn?: (turn: number, message: AgentMessage) => void;
}

export interface AgentLoopResult {
  success: boolean;
  message: string;
  steps: AgentStep[];
  turns: number;
  batchId?: string;
  creditsUsed?: number;
}

export const AGENT_SYSTEM_PROMPT = `Bạn là AI Director (Đạo diễn phim AI) của FlowGraph Studio.
Nhiệm vụ của bạn là nhận kịch bản/ý tưởng từ người dùng (Bố Thangterter), phân tích, dựng đồ thị node và kích hoạt quy trình sản xuất phim trên Google Flow.

QUY TẮC CỐT LÕI (BẮT BUỘC TUÂN THỦ):
1. GIỚI HẠN THỜI LƯỢNG VEo:
   - Mỗi clip video Veo tối đa 8 GIÂY (durationSec <= 8).
   - Kịch bản dài hơn 8 giây BẮT BUỘC phải tách thành nhiều cảnh nhỏ (Scene 01, Scene 02...) rồi nối tuần tự vào node 'videoConcat' để ghép timeline.
   - Tuyệt đối không tạo node video > 8s.

2. TÍNH NHẤT QUÁN NHÂN VẬT (CONTINUITY):
   - Khi kịch bản có nhân vật hoặc bối cảnh xuyên suốt: Luôn ưu tiên tạo 't2i' (tạo ảnh keyframe cố định tạo hình nhân vật) rồi nối sang 'i2v' (image-to-video) để giữ nguyên khuôn mặt và trang phục.
   - Cảnh phong cảnh, chuyển cảnh thuần túy không có nhân vật có thể dùng 't2v'.

3. BẢO VỆ CREDIT VÀ DUYỆT BẮT BUỘC:
   - Để render, bắt buộc phải đi qua 3 bước:
     a) Gọi tool 'propose_render' để tạo đề xuất (proposal) và ước tính credit.
     b) Gọi tool 'await_approval' để chờ người dùng bấm Duyệt trên Approval Card (nhận token).
     c) Gọi tool 'submit_render' kèm approvalToken nhận được để kích hoạt render.
   - Tuyệt đối không thử submitRender khi chưa có token hoặc token đã dùng.

4. CẤU TRÚC ĐỒ THỊ:
   - Các loại node: 'prompt', 't2i', 'i2v', 't2v', 'videoConcat', 'preview', 'download'.
   - Cổng vào/ra:
     * prompt: phát PROMPT
     * t2i: nhận PROMPT, phát IMAGE
     * i2v: nhận IMAGE và PROMPT, phát VIDEO
     * t2v: nhận PROMPT, phát VIDEO
     * videoConcat: nhận VIDEO, phát VIDEO
     * preview / download: nhận VIDEO
   - Luôn nối đầy đủ dây hợp lệ, không tạo chu trình lặp (cycle).

5. ĐỊNH DẠNG TRẢ LỜI:
   - Luôn trả lời bằng Tiếng Việt, ngắn gọn, đi thẳng vào kết quả kỹ thuật, báo rõ số cảnh, số credit và cấu trúc đã dựng.`;

export const AGENT_TOOLS: AgentTool[] = [
  {
    type: 'function',
    function: {
      name: 'read_graph',
      description: 'Đọc snapshot hiện tại của đồ thị (danh sách nodes, edges và revision).',
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
      name: 'get_credit_balance',
      description: 'Lấy số credit còn lại trong tài khoản Google Flow.',
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
      name: 'check_flow_tab',
      description: 'Kiểm tra trạng thái tab Google Flow (đã kết nối debugger chưa, đăng nhập, có bị kẹt captcha không).',
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
      name: 'create_node',
      description: 'Tạo một node mới trên canvas (loại node, nhãn và thông số params). Lưu ý video durationSec <= 8.',
      parameters: {
        type: 'object',
        properties: {
          kind: {
            type: 'string',
            enum: ['prompt', 't2i', 'i2v', 't2v', 'videoConcat', 'preview', 'download'],
            description: 'Loại node.',
          },
          label: {
            type: 'string',
            description: 'Tên hiển thị của node (ví dụ: "Scene 01 - Cổng làng").',
          },
          params: {
            type: 'object',
            properties: {
              prompt: { type: 'string', description: 'Nội dung prompt' },
              durationSec: { type: 'number', description: 'Thời lượng (chỉ cho i2v, t2v, tối đa 8s)' },
              model: { type: 'string', description: 'Tên model (ví dụ: "veo-3.1-fast")' },
              imageArtifactId: { type: 'string', description: 'Định danh ảnh keyframe (dạng stitch-idb:...)' },
            },
            description: 'Các thông số cấu hình của node.',
          },
        },
        required: ['kind'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_node',
      description: 'Cập nhật nhãn hoặc thông số params của một node hiện có.',
      parameters: {
        type: 'object',
        properties: {
          nodeId: { type: 'string', description: 'ID của node cần cập nhật' },
          label: { type: 'string', description: 'Nhãn mới (tùy chọn)' },
          params: {
            type: 'object',
            properties: {
              prompt: { type: 'string' },
              durationSec: { type: 'number' },
              model: { type: 'string' },
              imageArtifactId: { type: 'string' },
            },
            description: 'Các thông số cập nhật gộp vào node',
          },
        },
        required: ['nodeId'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_node',
      description: 'Xóa một node và toàn bộ các dây nối liên quan.',
      parameters: {
        type: 'object',
        properties: {
          nodeId: { type: 'string', description: 'ID của node cần xóa' },
        },
        required: ['nodeId'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'connect_edge',
      description: 'Nối dây giữa 2 node trên canvas. Kiểm tra đúng kiểu dữ liệu (PROMPT, IMAGE, VIDEO).',
      parameters: {
        type: 'object',
        properties: {
          kind: {
            type: 'string',
            enum: ['PROMPT', 'IMAGE', 'VIDEO'],
            description: 'Kiểu dây dữ liệu.',
          },
          source: { type: 'string', description: 'ID node nguồn phát dữ liệu' },
          target: { type: 'string', description: 'ID node đích nhận dữ liệu' },
        },
        required: ['kind', 'source', 'target'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'disconnect_edge',
      description: 'Gỡ bỏ một dây nối giữa các node.',
      parameters: {
        type: 'object',
        properties: {
          edgeId: { type: 'string', description: 'ID dây nối cần gỡ' },
        },
        required: ['edgeId'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'propose_render',
      description: 'Gửi đề xuất kế hoạch render để hiển thị lên Approval Card cho người dùng xem chi phí và các cảnh.',
      parameters: {
        type: 'object',
        properties: {
          model: { type: 'string', description: 'Tên model dùng để render (ví dụ: "veo-3.1-fast")' },
          scenes: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                sceneId: { type: 'string', description: 'Mã cảnh (ví dụ: "S01")' },
                nodeType: { type: 'string', enum: ['t2i', 'i2v', 't2v'], description: 'Loại tác vụ' },
                prompt: { type: 'string', description: 'Prompt chi tiết' },
                durationSec: { type: 'number', description: 'Thời lượng (<= 8s)' },
                imageArtifactId: { type: 'string', description: 'Artifact ID nếu là i2v' },
              },
              required: ['sceneId', 'nodeType', 'prompt', 'durationSec'],
            },
            description: 'Danh sách các cảnh cần render',
          },
        },
        required: ['model', 'scenes'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'await_approval',
      description: 'Chờ quyết định duyệt từ người dùng trên Approval Card. Trả về token nếu granted, hoặc status rejected/timeout.',
      parameters: {
        type: 'object',
        properties: {
          proposalId: { type: 'string', description: 'ID đề xuất nhận được từ propose_render' },
          timeoutMs: { type: 'number', description: 'Thời gian chờ tối đa bằng ms (mặc định 60000ms)' },
        },
        required: ['proposalId'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'submit_render',
      description: 'Kích hoạt render thật sự bằng token đã được người dùng cấp qua Approval Card.',
      parameters: {
        type: 'object',
        properties: {
          plan: {
            type: 'object',
            description: 'Kế hoạch render (phải khớp chính xác 100% với bản đã được duyệt)',
          },
          approvalToken: {
            type: 'string',
            description: 'Token duyệt cấp từ await_approval (dạng fgat_...)',
          },
        },
        required: ['plan', 'approvalToken'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_render_status',
      description: 'Lấy tiến độ chi tiết của batch render đang chạy.',
      parameters: {
        type: 'object',
        properties: {
          batchId: { type: 'string', description: 'Mã batch nhận được từ submit_render' },
        },
        required: ['batchId'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_artifacts',
      description: 'Liệt kê danh sách video/ảnh đã hoàn thiện trong kho lưu trữ IndexedDB cục bộ.',
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
      name: 'read_cdp_log',
      description: 'Đọc nhật ký chẩn đoán CDP và Google Flow để điều tra lỗi khi gặp sự cố.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Số dòng log tối đa' },
          minLevel: { type: 'string', enum: ['info', 'warn', 'error'] },
        },
        additionalProperties: false,
      },
    },
  },
];

export async function runAgentLoop(
  userScript: string,
  runtime: RuntimeApi,
  options: AgentLoopOptions = {}
): Promise<AgentLoopResult> {
  const maxTurns = options.maxTurns ?? 12;
  const signal = options.signal;
  const steps: AgentStep[] = [];
  let submittedBatchId: string | undefined;
  let creditsConsumed: number | undefined;

  const emitStep = (step: AgentStep) => {
    steps.push(step);
    options.onStep?.(step);
  };

  const client = options.customLlm ? undefined : (options.client || new AgentClient());
  const llmCall = options.customLlm || (async (msgs, tools, sig) => {
    if (!client) throw new Error('AgentClient not initialized');
    const res = await client.chat(msgs, tools, sig);
    return res.message;
  });

  const messages: AgentMessage[] = [
    { role: 'system', content: options.systemPrompt || AGENT_SYSTEM_PROMPT },
    { role: 'user', content: userScript },
  ];

  let turn = 0;
  let finalAssistantMessage = '';
  const callCounts = new Map<string, number>();

  while (turn < maxTurns) {
    if (signal?.aborted) {
      emitStep({
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        type: 'error',
        title: 'Quy trình đã bị hủy',
        details: 'Người dùng hoặc hệ thống đã phát tín hiệu abort.',
      });
      return { success: false, message: 'Đã hủy quy trình.', steps, turns: turn };
    }

    turn++;

    // 1. Gọi LLM
    let assistantMsg: AgentMessage;
    try {
      assistantMsg = await llmCall(messages, AGENT_TOOLS, signal);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      emitStep({
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        type: 'error',
        title: 'Lỗi gọi AI Gateway',
        details: errMsg,
      });
      return { success: false, message: `Lỗi kết nối AI: ${errMsg}`, steps, turns: turn };
    }

    options.onTurn?.(turn, assistantMsg);
    messages.push(assistantMsg);

    if (assistantMsg.content) {
      finalAssistantMessage = assistantMsg.content;
      emitStep({
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        type: 'thought',
        title: `Phản hồi vòng ${turn}`,
        details: assistantMsg.content,
      });
    }

    // 2. Kiểm tra nếu LLM không gọi tool nào -> Hoàn tất vòng lặp
    if (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0) {
      break;
    }

    // 3. Thực thi lần lượt các tool calls
    for (const toolCall of assistantMsg.tool_calls) {
      if (signal?.aborted) break;

      const fnName = toolCall.function.name;
      let args: Record<string, any> = {};
      try {
        args = JSON.parse(toolCall.function.arguments || '{}');
      } catch {
        args = {};
      }

      emitStep({
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        type: 'tool_call',
        title: `Gọi công cụ: ${fnName}`,
        toolName: fnName,
        toolArgs: args,
      });

      let toolOutput: unknown;

      const callSig = `${fnName}:${canonicalJson(args)}`;
      const prevCalls = callCounts.get(callSig) || 0;
      callCounts.set(callSig, prevCalls + 1);

      if (prevCalls >= 2) {
        toolOutput = {
          ok: false,
          error: {
            code: 'REPETITIVE_TOOL_CALL',
            message: `Phát hiện gọi lặp công cụ "${fnName}" với cùng tham số liên tiếp. Hãy đổi chiến lược hoặc báo kết quả cho người dùng.`,
          },
        };
      } else {
        try {
          switch (fnName) {
          case 'read_graph': {
            toolOutput = await runtime.readGraph();
            break;
          }
          case 'get_credit_balance': {
            toolOutput = await runtime.getCreditBalance();
            break;
          }
          case 'check_flow_tab': {
            toolOutput = await runtime.checkFlowTab();
            break;
          }
          case 'create_node': {
            toolOutput = await runtime.createNode(args as CreateNodeInput);
            break;
          }
          case 'update_node': {
            const { nodeId, ...patch } = args;
            toolOutput = await runtime.updateNode(nodeId, patch as UpdateNodePatch);
            break;
          }
          case 'delete_node': {
            toolOutput = await runtime.deleteNode(args.nodeId);
            break;
          }
          case 'connect_edge': {
            toolOutput = await runtime.connectEdge(args as ConnectEdgeInput);
            break;
          }
          case 'disconnect_edge': {
            toolOutput = await runtime.disconnectEdge(args.edgeId);
            break;
          }
          case 'propose_render': {
            const res = await runtime.proposeRender(args as RenderPlan);
            toolOutput = res;
            if (res.ok) {
              emitStep({
                id: crypto.randomUUID(),
                timestamp: Date.now(),
                type: 'approval_required',
                title: 'Đã gửi đề xuất duyệt kịch bản',
                details: `Mã đề xuất: ${res.value.proposalId} | Ước tính: ${res.value.credits} credits | Số cảnh: ${res.value.sceneCount}`,
                toolResult: res.value,
              });
            }
            break;
          }
          case 'await_approval': {
            toolOutput = await runtime.awaitApproval(args.proposalId, args.timeoutMs);
            break;
          }
          case 'submit_render': {
            const res = await runtime.submitRender(args as any);
            toolOutput = res;
            if (res.ok) {
              submittedBatchId = res.value.batchId;
              creditsConsumed = res.value.credits;
              emitStep({
                id: crypto.randomUUID(),
                timestamp: Date.now(),
                type: 'render_started',
                title: 'Đã kích hoạt render trên Google Flow',
                details: `Batch: ${res.value.batchId} | Trừ: ${res.value.credits} credits`,
                toolResult: res.value,
              });
            }
            break;
          }
          case 'get_render_status': {
            toolOutput = await runtime.getRenderStatus(args.batchId);
            break;
          }
          case 'list_artifacts': {
            toolOutput = await runtime.listArtifacts();
            break;
          }
          case 'read_cdp_log': {
            toolOutput = await runtime.readCdpLog(args);
            break;
          }
          default: {
            toolOutput = { ok: false, error: { code: 'UNKNOWN_TOOL', message: `Công cụ ${fnName} không tồn tại.` } };
          }
        }
      } catch (err) {
        toolOutput = {
          ok: false,
          error: {
            code: 'TOOL_EXECUTION_ERROR',
            message: err instanceof Error ? err.message : String(err),
          },
        };
      }
      }

      emitStep({
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        type: 'tool_result',
        title: `Kết quả: ${fnName}`,
        toolName: fnName,
        toolResult: toolOutput,
      });

      // Đưa kết quả công cụ vào ngữ cảnh hội thoại cho vòng lặp kế tiếp
      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        name: fnName,
        content: JSON.stringify(toolOutput),
      });
    }
  }

  const isSuccess = Boolean(submittedBatchId || steps.some((s) => s.type === 'tool_result' && (s.toolResult as any)?.ok));

  emitStep({
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    type: isSuccess ? 'success' : 'error',
    title: isSuccess ? 'Hoàn tất quy trình ReAct Agent' : 'Quy trình kết thúc không có thay đổi',
    details: finalAssistantMessage || (isSuccess ? 'Đã thực hiện xong các bước.' : 'Chưa có hành động nào được kích hoạt.'),
  });

  return {
    success: isSuccess,
    message: finalAssistantMessage || 'Đã hoàn tất phân tích và thực thi.',
    steps,
    turns: turn,
    batchId: submittedBatchId,
    creditsUsed: creditsConsumed,
  };
}
