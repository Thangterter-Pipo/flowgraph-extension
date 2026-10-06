import { AgentClient } from './AgentClient';
import { AGENT_TOOLS, FlowGraphAgentToolRunner, type ToolExecutionContext } from './FlowGraphAgentTools';
import type {
  AgentApprovalRequest,
  AgentExecutionOptions,
  AgentMessage,
  AgentStatus,
  AgentStep,
} from './types';

export class FlowGraphAgent {
  private client: AgentClient;
  private toolRunner: FlowGraphAgentToolRunner;
  private status: AgentStatus = 'idle';
  private abortController: AbortController | null = null;
  private options: AgentExecutionOptions;

  constructor(context: ToolExecutionContext, options: AgentExecutionOptions = {}) {
    this.client = new AgentClient();
    this.toolRunner = new FlowGraphAgentToolRunner(context);
    this.options = options;
  }

  public getStatus(): AgentStatus {
    return this.status;
  }

  private setStatus(newStatus: AgentStatus): void {
    this.status = newStatus;
    this.options.onStatusChange?.(newStatus);
  }

  private emitStep(step: Omit<AgentStep, 'id' | 'timestamp'>): void {
    const fullStep: AgentStep = {
      id: `step_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: Date.now(),
      ...step,
    };
    this.options.onStep?.(fullStep);
  }

  public abort(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.setStatus('aborted');
    this.emitStep({
      type: 'error',
      title: 'Đã hủy tác vụ',
      details: 'Người dùng đã bấm dừng tác vụ của Agent.',
    });
  }

  public async runPrompt(userPrompt: string): Promise<{ success: boolean; summary?: string; error?: string }> {
    const promptText = (userPrompt || '').trim();
    if (!promptText) {
      return { success: false, error: 'Prompt không được để trống.' };
    }

    this.abortController = new AbortController();
    const signal = this.abortController.signal;
    this.setStatus('running');

    this.emitStep({
      type: 'thought',
      title: 'Khởi động Đạo diễn AI',
      details: `Bắt đầu tiếp nhận kịch bản: "${promptText.slice(0, 100)}${promptText.length > 100 ? '...' : ''}"`,
    });

    const systemPrompt = `You are the Lead AI Film Director and Master Graph Architect for FlowGraph Studio (a professional node-based filmmaking runtime for Google Flow / Veo 3 / Imagen 3).

Your objective is NOT to quickly slap down pre-made templates.
Your objective is to THINK, ANALYZE, AND CRAFT A PROFESSIONAL CINEMATIC WORKFLOW with the depth, skill, and visual intelligence of a world-class filmmaker and cinematographer.

═════════════════════════════════════════════════════════════════════════
THE 5 PILLARS OF CINEMATIC REASONING (YOU MUST APPLY THESE IN EVERY RUN):
═════════════════════════════════════════════════════════════════════════

1. VISUAL BIBLE & ATMOSPHERE (Định hình Thị Giác):
   - Analyze the genre, emotional tone, and narrative arc of the user's prompt.
   - Establish a unified Visual Bible:
     * Color Grading: e.g. "Kodak 2383 warm amber with cool shadows", "Bleach bypass cold metallic", "Cyberpunk neon teal & magenta".
     * Lighting Key: e.g. "Chiaroscuro low-key lighting with hard rim light", "Soft diffused overcast daylight with volumetric haze", "Golden hour backlighting".
     * Environment & Weather: wet asphalt reflections, floating dust motes, heavy mist.
     * Character & Asset Consistency: Define exact recurring character physical traits (clothing, face, age, colors) so consecutive shots do not look like different people.

2. SHOT CHOREOGRAPHY & CAMERA GRAMMAR (Ngôn Ngữ Ống Kính):
   - Break the story down into distinct cinematic beats (2 to 6 shots, or 9 shots for storyboard grids).
   - For EACH shot, deliberately specify:
     * Shot Scale: Extreme Wide Establishing (EWS), Wide Shot (WS), Medium Shot (MS), Over-The-Shoulder (OTS), Close-Up (CU), Extreme Close-Up (ECU).
     * Camera Motion: Slow push-in (dolly in), tracking shot along subject motion, orbiting steadicam, low-angle tilt-up, handheld visceral shake, high-angle crane reveal.
     * Lens & Composition: 35mm anamorphic with shallow depth of field, 85mm portrait telephoto bokeh, wide-angle 24mm perspective.

3. STRATEGIC PIPELINE ARCHITECTURE (Chọn Công Cụ Đúng Tính Chất):
   A master director does NOT just use "Text to Video" blindly for everything!
   - When to use 't2i' (Text to Image) -> 'i2v' (Image to Video):
     CRITICAL: Use this whenever a story has a continuous character or asset! Generating the keyframe image first locks the character face, hair, and costume before motion is generated. Naked 't2v' will cause severe character drift between shots!
   - When to use 'interpolation' (Start - End Frame):
     Use this when a scene depicts a transition between two distinct states (e.g. from day to night, character walking from shadow into light, before and after action).
   - When to use 't2v' (Text to Video):
     Use this for dynamic establishing shots, atmospheric landscapes, or direct motion shots without recurrent close-up faces.
   - When to use 'videoConcat' (Stitch / Timeline):
     Always assemble the final film scenes sequentially into a videoConcat node, connected to a 'download' node, so the user obtains the complete stitched movie.

4. REALISTIC PHYSICAL LIMITS OF GOOGLE FLOW (VEO 3 & OMNI):
   - Duration Limits: Google Flow DOES NOT support generating single video shots of 25s, 30s, or 38s!
     * For 'Veo 3.1 - Fast' or 'Veo 3.1': Duration MUST be '8 seconds' (or '4 seconds', '6 seconds').
     * For 'Omni 1.1 Flash': Duration MUST be '10 seconds' (or '8 seconds', '6 seconds', '4 seconds').
     * NEVER set an arbitrary duration like 25s or 36s on a video node; break long events into 8s/10s sequential shots stitched via videoConcat.
   - Aspect Ratio: '16:9 (Landscape)' or '9:16 (Portrait)' or '1:1 (Square)'.
   - Resolution: '720p' or '1080p'.

5. FULL RUNTIME COMMAND SUITE (BỘ LỆNH ĐIỀU KHIỂN RUNTIME ĐẦY ĐỦ):
   You have complete authority and tools to direct, construct, validate, and execute:
   - 'get_available_nodes': Inspect supported nodes, inputs, outputs, defaults.
   - 'get_current_graph': Read canvas nodes and edges.
   - 'add_node', 'update_node_config', 'connect_nodes', 'disconnect_edge', 'remove_node': Full graph manipulation.
   - 'clear_canvas': Destructive graph manipulation; the tool must wait for the user's explicit confirmation before removing anything.
   - 'auto_layout': Organize graph cleanly.
   - 'validate_graph': Verify graph validity.
   - 'request_render_approval': Present cinematic treatment, scene breakdown, and credit estimate to the user.
   - 'trigger_render': ACTUALLY EXECUTE AND START RENDERING VIDEO ON GOOGLE FLOW. Mode can be 'continue' or 'restart'.
   - 'get_run_status': Inspect live execution progress, status, and feedback.
   - 'cancel_render': Stop rendering if needed.

   IMPORTANT: YOU HAVE THE COMMAND TO RENDER DIRECTLY ('trigger_render').
   - After designing the graph and validating it:
     Call 'request_render_approval' to present your work to the user.
     When the user approves, or if the user's initial prompt explicitly said "tạo và chạy/render ngay", call 'trigger_render' to commence production!
     NEVER claim "runtime chưa cung cấp lệnh kích hoạt render" because 'trigger_render' IS available to you!

6. OPERATIONAL DISCIPLINE:
   - Step 1: Explain your Creative Vision and Visual Bible to the user in Vietnamese (first thought response).
   - Step 2: Use 'add_node' to instantiate the required Prompt nodes, Generative nodes (t2v, t2i, i2v, etc.), Stitch node, and Download node.
   - Step 3: Use 'update_node_config' to set detailed cinematic prompts and parameters (resolution 720p, duration 8 seconds for Veo / 10 seconds for Omni, aspect ratio 16:9).
   - Step 4: Use 'connect_nodes' to form valid data wires (PROMPT -> prompt, IMAGE -> image/startImage, VIDEO -> video/videos).
   - Step 5: Use 'auto_layout' to neatly format the pipeline so the canvas is structured and beautiful.
   - Step 6: Use 'validate_graph' to verify zero cycles and zero missing ports.
   - Step 7: Call 'request_render_approval' presenting your Director's Treatment, scene breakdown, and estimated credits.
   - Step 8: Once approved (or if commanded to run immediately), invoke 'trigger_render' and report that production has started.
   - Never bypass the confirmation gate for 'clear_canvas'. If the user declines, keep the existing canvas unchanged.

Demonstrate genuine filmmaking craft. Never take lazy shortcuts.`;

    const messages: AgentMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: promptText },
    ];

    const maxTurns = this.options.maxTurns || 15;
    let turnCount = 0;
    let finalSummary = '';

    try {
      while (turnCount < maxTurns) {
        if (signal.aborted) {
          return { success: false, error: 'Tác vụ đã bị hủy bởi người dùng.' };
        }

        turnCount++;
        const response = await this.client.chat(messages, AGENT_TOOLS, signal);
        const assistantMsg = response.message;
        messages.push(assistantMsg);

        if (assistantMsg.content) {
          this.emitStep({
            type: 'thought',
            title: turnCount === 1 ? '🎬 Bản Định Hướng Đạo Diễn (Director’s Treatment)' : `Tư duy phân cảnh (Lượt ${turnCount})`,
            details: assistantMsg.content,
          });
          finalSummary = assistantMsg.content;
        }

        const toolCalls = assistantMsg.tool_calls;
        if (!toolCalls || toolCalls.length === 0) {
          break;
        }

        for (const call of toolCalls) {
          if (signal.aborted) {
            return { success: false, error: 'Tác vụ đã bị hủy bởi người dùng.' };
          }

          let args: Record<string, any> = {};
          try {
            args = JSON.parse(call.function.arguments || '{}');
          } catch {
            args = {};
          }

          this.emitStep({
            type: 'tool_call',
            title: `⚙️ Thực thi: ${call.function.name}`,
            toolName: call.function.name,
            toolArgs: args,
            details: `Tham số: ${JSON.stringify(args).slice(0, 220)}...`,
          });

          let result: any;
          try {
            result = await this.toolRunner.executeTool(call.function.name, args);
            this.emitStep({
              type: 'tool_result',
              title: `✓ Hoàn thành: ${call.function.name}`,
              toolName: call.function.name,
              toolResult: result,
              details: typeof result === 'object' ? JSON.stringify(result).slice(0, 250) : String(result),
            });
          } catch (toolErr: any) {
            result = { error: toolErr?.message || 'Lỗi thực thi công cụ' };
            this.emitStep({
              type: 'error',
              title: `✗ Lỗi công cụ: ${call.function.name}`,
              toolName: call.function.name,
              details: result.error,
            });
          }

          messages.push({
            role: 'tool',
            name: call.function.name,
            tool_call_id: call.id,
            content: JSON.stringify(result),
          });
        }
      }

      this.setStatus('success');
      this.emitStep({
        type: 'success',
        title: 'Quy trình điện ảnh đã sẵn sàng',
        details: finalSummary || 'Agent đã hoàn tất phân tích kịch bản và thiết kế đồ thị điện ảnh.',
      });

      return {
        success: true,
        summary: finalSummary,
      };
    } catch (err: any) {
      if (signal.aborted) {
        return { success: false, error: 'Tác vụ đã bị hủy bởi người dùng.' };
      }
      this.setStatus('error');
      const errMsg = err?.message || 'Lỗi không xác định khi chạy Agent';
      this.emitStep({
        type: 'error',
        title: 'Lỗi trong quá trình Agent thực thi',
        details: errMsg,
      });
      return { success: false, error: errMsg };
    } finally {
      this.abortController = null;
    }
  }
}
