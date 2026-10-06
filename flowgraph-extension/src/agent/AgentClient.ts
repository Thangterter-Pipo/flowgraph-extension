import { loadSettings } from '../ui/studio/SettingsModal';
import type { AgentMessage, AgentTool, ToolCall } from './types';

export interface AgentClientConfig {
  baseUrl?: string;
  token?: string;
  model?: string;
}

export interface ChatCompletionResponse {
  message: AgentMessage;
  finishReason?: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

function sanitizeLogUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return rawUrl;
  }
}

export class AgentClient {
  private baseUrl: string;
  private bearerToken: string;
  private model: string;

  constructor(customConfig?: AgentClientConfig) {
    const settings = loadSettings();
    this.baseUrl = (customConfig?.baseUrl || settings.aiGatewayUrl || 'http://localhost:20128/v1').replace(/\/$/, '');
    const userDefinedToken = customConfig?.token !== undefined ? customConfig.token : settings.aiApiKey;
    this.bearerToken = userDefinedToken || 'Thangterter';
    this.model = customConfig?.model || settings.aiModel || 'cx/gpt-5.6-luna';
  }

  public getConfig(): { baseUrl: string; model: string; hasToken: boolean } {
    return {
      baseUrl: sanitizeLogUrl(this.baseUrl),
      model: this.model,
      hasToken: Boolean(this.bearerToken),
    };
  }

  private cleanJsonPayload(text: string): any {
    let clean = (text || '').trim();
    if (clean.endsWith('data: [DONE]')) {
      clean = clean.slice(0, -12).trim();
    }
    if (clean.startsWith('```')) {
      clean = clean.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    }
    try {
      return JSON.parse(clean);
    } catch {
      const first = clean.indexOf('{');
      const last = clean.lastIndexOf('}');
      if (first !== -1 && last !== -1 && last > first) {
        return JSON.parse(clean.slice(first, last + 1));
      }
      throw new Error(`Invalid JSON returned from AI Gateway: ${clean.slice(0, 150)}...`);
    }
  }

  private async executeFetch(
    url: string,
    headers: Record<string, string>,
    bodyStr: string,
    signal?: AbortSignal
  ): Promise<string> {
    if (typeof chrome !== 'undefined' && chrome?.runtime?.sendMessage) {
      const bridgeRes: any = await new Promise((resolve, reject) => {
        if (signal?.aborted) {
          return reject(new Error('Aborted'));
        }
        const onAbort = () => reject(new Error('Aborted'));
        signal?.addEventListener('abort', onAbort, { once: true });

        chrome.runtime.sendMessage(
          {
            type: 'FLOWGRAPH_PROXY_FETCH',
            payload: { url, method: 'POST', headers, body: bodyStr },
          },
          (reply) => {
            signal?.removeEventListener('abort', onAbort);
            resolve(reply);
          }
        );
      });

      const response = bridgeRes?.data || bridgeRes?.payload;
      if (!response?.ok) {
        const status = response?.status || 500;
        const msg = response?.text || response?.statusText || 'Bridge fetch failed';
        const err = new Error(`AI Gateway error HTTP ${status}: ${msg}`);
        (err as any).status = status;
        (err as any).responseText = msg;
        throw err;
      }
      return response.text;
    }

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: bodyStr,
      signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      const err = new Error(`AI Gateway error HTTP ${res.status}: ${errText || res.statusText}`);
      (err as any).status = res.status;
      (err as any).responseText = errText;
      throw err;
    }
    return await res.text();
  }

  public async chat(
    messages: AgentMessage[],
    tools: AgentTool[],
    signal?: AbortSignal
  ): Promise<ChatCompletionResponse> {
    if (!this.bearerToken) {
      throw new Error('Chưa thiết lập AI Token. Vui lòng mở Settings và kiểm tra cấu hình.');
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.bearerToken}`,
    };

    const makePayload = (modelName: string) => ({
      model: modelName,
      messages,
      tools: tools.length > 0 ? tools : undefined,
      tool_choice: tools.length > 0 ? 'auto' : undefined,
      temperature: 0.65,
      max_tokens: 2000,
    });

    const url = `${this.baseUrl}/chat/completions`;

    let activeModel = this.model;
    let rawText: string;

    try {
      rawText = await this.executeFetch(url, headers, JSON.stringify(makePayload(activeModel)), signal);
    } catch (err: any) {
      if (err?.status === 404 && activeModel.startsWith('cx/')) {
        const fallbackModel = activeModel.replace(/^cx\//, 'x/');
        console.warn(`[AgentClient] Model ${activeModel} not found (404), trying fallback ${fallbackModel}`);
        try {
          rawText = await this.executeFetch(url, headers, JSON.stringify(makePayload(fallbackModel)), signal);
          activeModel = fallbackModel;
        } catch {
          throw err;
        }
      } else {
        throw err;
      }
    }

    const json = this.cleanJsonPayload(rawText);
    const choice = json.choices?.[0];
    if (!choice || !choice.message) {
      throw new Error('AI Gateway không trả về lựa chọn hợp lệ.');
    }

    const resMsg = choice.message;
    const toolCalls: ToolCall[] = [];

    if (Array.isArray(resMsg.tool_calls)) {
      for (const tc of resMsg.tool_calls) {
        if (tc.type === 'function' && tc.function?.name) {
          toolCalls.push({
            id: tc.id || `call_${Math.random().toString(36).slice(2, 9)}`,
            type: 'function',
            function: {
              name: tc.function.name,
              arguments: typeof tc.function.arguments === 'string'
                ? tc.function.arguments
                : JSON.stringify(tc.function.arguments || {}),
            },
          });
        }
      }
    }

    return {
      message: {
        role: 'assistant',
        content: resMsg.content || null,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      },
      finishReason: choice.finish_reason,
      usage: json.usage
        ? {
            promptTokens: json.usage.prompt_tokens,
            completionTokens: json.usage.completion_tokens,
            totalTokens: json.usage.total_tokens,
          }
        : undefined,
    };
  }
}
