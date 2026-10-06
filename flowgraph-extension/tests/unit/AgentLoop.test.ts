import { describe, it, expect, vi } from 'vitest';
import { runAgentLoop, AGENT_TOOLS } from '../../src/agent/loop';
import { MockRuntime } from '../mocks/mock-runtime';
import type { AgentMessage, ToolCall } from '../../src/agent/types';
import type { RenderPlan } from '../../src/shared/approval-types';

describe('ReAct Agent Loop (src/agent/loop.ts)', () => {
  it('thực hiện trọn vẹn chu trình ReAct: đọc đồ thị -> tạo node -> xin duyệt -> nhận token -> submit render', async () => {
    const mock = new MockRuntime({ approval: 'auto-approve', creditBalance: 500 });

    // Giả lập LLM thực hiện 3 lượt suy nghĩ và gọi công cụ
    let turnCount = 0;
    const customLlm = async (messages: AgentMessage[]): Promise<AgentMessage> => {
      turnCount++;

      if (turnCount === 1) {
        // Lượt 1: Tạo 1 node prompt và 1 node t2v
        return {
          role: 'assistant',
          content: 'Tôi sẽ bắt đầu bằng việc kiểm tra số dư và tạo node cảnh 1.',
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: {
                name: 'create_node',
                arguments: JSON.stringify({
                  kind: 't2v',
                  label: 'Scene 01 - Khởi đầu',
                  params: { prompt: 'Một phi hành gia bước ra khỏi trạm vũ trụ', durationSec: 8, model: 'veo-3.1-fast' },
                }),
              },
            },
          ],
        };
      }

      if (turnCount === 2) {
        // Lượt 2: Gửi đề xuất duyệt kịch bản (propose_render)
        const plan: RenderPlan = {
          model: 'veo-3.1-fast',
          scenes: [
            {
              sceneId: 'S01',
              nodeType: 't2v',
              prompt: 'Một phi hành gia bước ra khỏi trạm vũ trụ',
              durationSec: 8,
            },
          ],
        };
        return {
          role: 'assistant',
          content: 'Đã tạo node xong, bây giờ tôi sẽ gửi đề xuất duyệt chi phí lên Approval Card.',
          tool_calls: [
            {
              id: 'call_2',
              type: 'function',
              function: {
                name: 'propose_render',
                arguments: JSON.stringify(plan),
              },
            },
          ],
        };
      }

      if (turnCount === 3) {
        // Lượt 3: Đọc proposalId từ tool result trước và gọi await_approval
        const lastToolMsg = messages[messages.length - 1];
        const res = JSON.parse(lastToolMsg.content || '{}');
        const proposalId = res.value?.proposalId;

        return {
          role: 'assistant',
          content: 'Đang đợi người dùng duyệt trên Approval Card...',
          tool_calls: [
            {
              id: 'call_3',
              type: 'function',
              function: {
                name: 'await_approval',
                arguments: JSON.stringify({ proposalId, timeoutMs: 2000 }),
              },
            },
          ],
        };
      }

      if (turnCount === 4) {
        // Lượt 4: Nhận token từ await_approval và gọi submit_render
        const lastToolMsg = messages[messages.length - 1];
        const res = JSON.parse(lastToolMsg.content || '{}');
        const token = res.value?.token?.token;

        const plan: RenderPlan = {
          model: 'veo-3.1-fast',
          scenes: [
            {
              sceneId: 'S01',
              nodeType: 't2v',
              prompt: 'Một phi hành gia bước ra khỏi trạm vũ trụ',
              durationSec: 8,
            },
          ],
        };

        return {
          role: 'assistant',
          content: 'Đã có token duyệt hợp lệ, kích hoạt render!',
          tool_calls: [
            {
              id: 'call_4',
              type: 'function',
              function: {
                name: 'submit_render',
                arguments: JSON.stringify({
                  plan,
                  approvalToken: token,
                }),
              },
            },
          ],
        };
      }

      // Lượt 5: Hoàn tất, trả lời người dùng
      return {
        role: 'assistant',
        content: 'Báo cáo Bố: Đã dựng xong đồ thị cảnh 1 và kích hoạt render thành công trên Google Flow!',
      };
    };

    const result = await runAgentLoop('Hãy làm cho bố một clip 8 giây về phi hành gia', mock, {
      customLlm,
      maxTurns: 10,
    });

    expect(result.success).toBe(true);
    expect(result.batchId).toBeDefined();
    expect(mock.submissions.length).toBe(1);
    expect(mock.creditsSpent).toBe(20);
    expect(mock.creditsRemaining).toBe(480);
    expect(result.message).toContain('kích hoạt render thành công');
    expect(result.steps.some((s) => s.type === 'approval_required')).toBe(true);
    expect(result.steps.some((s) => s.type === 'render_started')).toBe(true);
  });

  it('xử lý khi người dùng từ chối duyệt: không gọi submit_render và kết thúc an toàn', async () => {
    const mock = new MockRuntime({ approval: 'auto-reject' });

    let turn = 0;
    const customLlm = async (messages: AgentMessage[]): Promise<AgentMessage> => {
      turn++;
      if (turn === 1) {
        return {
          role: 'assistant',
          tool_calls: [
            {
              id: 'c1',
              type: 'function',
              function: {
                name: 'propose_render',
                arguments: JSON.stringify({
                  model: 'veo-3.1-fast',
                  scenes: [{ sceneId: 'S01', nodeType: 't2v', prompt: 'test', durationSec: 5 }],
                }),
              },
            },
          ],
        };
      }
      if (turn === 2) {
        const last = JSON.parse(messages[messages.length - 1].content || '{}');
        return {
          role: 'assistant',
          tool_calls: [
            {
              id: 'c2',
              type: 'function',
              function: {
                name: 'await_approval',
                arguments: JSON.stringify({ proposalId: last.value.proposalId }),
              },
            },
          ],
        };
      }
      return {
        role: 'assistant',
        content: 'Người dùng đã từ chối duyệt kịch bản, dừng quy trình.',
      };
    };

    const result = await runAgentLoop('Dựng phim', mock, { customLlm });
    expect(mock.submissions.length).toBe(0);
    expect(mock.creditsSpent).toBe(0);
    expect(result.message).toContain('Người dùng đã từ chối');
  });

  it('phát hiện và xử lý lỗi khi vi phạm bất biến video > 8s', async () => {
    const mock = new MockRuntime();

    let turn = 0;
    let receivedError = false;

    const customLlm = async (messages: AgentMessage[]): Promise<AgentMessage> => {
      turn++;
      if (turn === 1) {
        // Cố tình tạo video 25s
        return {
          role: 'assistant',
          tool_calls: [
            {
              id: 'c1',
              type: 'function',
              function: {
                name: 'create_node',
                arguments: JSON.stringify({
                  kind: 't2v',
                  params: { prompt: 'Cảnh dài', durationSec: 25 },
                }),
              },
            },
          ],
        };
      }
      if (turn === 2) {
        const last = JSON.parse(messages[messages.length - 1].content || '{}');
        if (last.ok === false && last.error?.code === 'INVARIANT_VIOLATION') {
          receivedError = true;
        }
        // Sau khi nhận lỗi, tạo lại node chuẩn 8s
        return {
          role: 'assistant',
          tool_calls: [
            {
              id: 'c2',
              type: 'function',
              function: {
                name: 'create_node',
                arguments: JSON.stringify({
                  kind: 't2v',
                  params: { prompt: 'Cảnh đã tách', durationSec: 8 },
                }),
              },
            },
          ],
        };
      }
      return {
        role: 'assistant',
        content: 'Đã sửa lại thành cảnh 8 giây theo đúng quy tắc Veo.',
      };
    };

    const result = await runAgentLoop('Tạo video 25s', mock, { customLlm });
    expect(receivedError).toBe(true);
    expect(result.success).toBe(true);
    const graphRes = await mock.readGraph();
    expect(graphRes.ok).toBe(true);
    if (graphRes.ok) {
      expect(graphRes.value.nodes.length).toBe(1);
      expect(graphRes.value.nodes[0].params.durationSec).toBe(8);
    }
  });

  it('dừng vòng lặp ngay khi nhận tín hiệu AbortSignal', async () => {
    const mock = new MockRuntime();
    const controller = new AbortController();

    const customLlm = async (): Promise<AgentMessage> => {
      controller.abort(); // Hủy ngay trong lượt đầu
      return {
        role: 'assistant',
        tool_calls: [
          {
            id: 'c1',
            type: 'function',
            function: { name: 'get_credit_balance', arguments: '{}' },
          },
        ],
      };
    };

    const result = await runAgentLoop('Chạy tác vụ', mock, {
      customLlm,
      signal: controller.signal,
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain('Đã hủy quy trình');
    expect(result.steps.some((s) => s.type === 'error' && s.title.includes('hủy'))).toBe(true);
  });

  it('giới hạn số lượt chạy (maxTurns) tránh lặp vô hạn', async () => {
    const mock = new MockRuntime();

    // LLM liên tục gọi tool không ngừng
    const customLlm = async (): Promise<AgentMessage> => ({
      role: 'assistant',
      tool_calls: [
        {
          id: 'loop_call',
          type: 'function',
          function: { name: 'get_credit_balance', arguments: '{}' },
        },
      ],
    });

    const result = await runAgentLoop('Vòng lặp bất tận', mock, {
      customLlm,
      maxTurns: 3,
    });

    expect(result.turns).toBe(3);
  });

  it('nhận diện và chặn lời gọi lặp công cụ với cùng tham số nhờ canonicalJson', async () => {
    const mock = new MockRuntime();
    let repetitiveErrorCaught = false;

    let turn = 0;
    const customLlm = async (messages: AgentMessage[]): Promise<AgentMessage> => {
      turn++;
      if (turn <= 3) {
        // Gọi cùng 1 lệnh 3 lần liên tiếp với cùng tham số
        return {
          role: 'assistant',
          tool_calls: [
            {
              id: `c_${turn}`,
              type: 'function',
              function: { name: 'get_credit_balance', arguments: '{}' },
            },
          ],
        };
      }

      // Lần thứ 4, kiểm tra xem tool result có cảnh báo REPETITIVE_TOOL_CALL không
      const last = JSON.parse(messages[messages.length - 1].content || '{}');
      if (last.ok === false && last.error?.code === 'REPETITIVE_TOOL_CALL') {
        repetitiveErrorCaught = true;
      }
      return {
        role: 'assistant',
        content: 'Phát hiện lặp công cụ, đã dừng lại báo cáo.',
      };
    };

    const result = await runAgentLoop('Thử gọi lặp', mock, { customLlm, maxTurns: 5 });
    expect(repetitiveErrorCaught).toBe(true);
    expect(result.message).toContain('Phát hiện lặp công cụ');
  });
});
