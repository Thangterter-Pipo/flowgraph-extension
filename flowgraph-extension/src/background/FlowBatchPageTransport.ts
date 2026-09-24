import { FLOW_BATCH_PATH } from '../adapters/google-flow/batch/FlowBatchProtocol';

export interface FlowBatchPageResult {
  status: number;
  text: string;
  matched?: boolean;
}

export class FlowBatchPageTransportError extends Error {
  constructor(
    public readonly code: 'NO_AT_TOKEN' | 'NO_INJECTION_RESULT' | 'BATCH_HTTP_ERROR',
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'FlowBatchPageTransportError';
  }
}

export interface RunFlowBatchPageRpcOptions {
  tabId: number;
  rpcId: string;
  fReq: string;
  /** Optional narrow response window around one operation/media id. */
  match?: string;
  /** Cap copied response text. Large project listings can exceed 17 MB. */
  maxText?: number;
}

/**
 * Execute Flow's batchexecute request inside the signed-in page MAIN world.
 *
 * The page owns the cookie session and WIZ anti-CSRF metadata. This function
 * does not mint reCAPTCHA; callers must replace the protocol CAPTCHA slot with
 * a fresh page-generated token immediately before calling.
 */
export async function runFlowBatchPageRpc(
  options: RunFlowBatchPageRpcOptions,
): Promise<FlowBatchPageResult> {
  const maxText = options.maxText ?? 32_000_000;
  const results = await chrome.scripting.executeScript({
    target: { tabId: options.tabId },
    world: 'MAIN',
    args: [options.rpcId, options.fReq, options.match ?? null, maxText, FLOW_BATCH_PATH],
    func: async (
      rpcId: string,
      fReq: string,
      match: string | null,
      textLimit: number,
      batchPath: string,
    ) => {
      const page = globalThis as typeof globalThis & {
        WIZ_global_data?: {
          SNlM0e?: string;
          FdrFJe?: string;
          cfb2h?: string;
        };
      };
      const wiz = page.WIZ_global_data ?? {};
      const at = wiz.SNlM0e;
      if (!at) return { error: 'NO_AT_TOKEN' as const };

      const sid = wiz.FdrFJe ?? '';
      const bl = wiz.cfb2h ?? '';
      const reqId = Math.floor(Math.random() * 900_000) + 100_000;
      const sourcePath = location.pathname || '/';
      const language = (document.documentElement.lang || navigator.language || 'en').split('-')[0];

      const url =
        `${batchPath}?rpcids=${encodeURIComponent(rpcId)}`
        + `&source-path=${encodeURIComponent(sourcePath)}`
        + `&bl=${encodeURIComponent(bl)}`
        + `&f.sid=${encodeURIComponent(sid)}`
        + `&hl=${encodeURIComponent(language)}`
        + `&_reqid=${reqId}&rt=c`;

      const response = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'x-same-domain': '1',
        },
        body: new URLSearchParams({ 'f.req': fReq, at }),
      });
      const text = await response.text();

      if (match) {
        const index = text.indexOf(match);
        return {
          status: response.status,
          matched: index >= 0,
          text: index >= 0 ? text.slice(index, index + 800) : '',
        };
      }

      return {
        status: response.status,
        text: text.slice(0, textLimit),
      };
    },
  });

  const result = results?.[0]?.result as
    | { error?: 'NO_AT_TOKEN'; status?: number; text?: string; matched?: boolean }
    | undefined;

  if (!result) {
    throw new FlowBatchPageTransportError(
      'NO_INJECTION_RESULT',
      'Flow batch RPC returned no MAIN-world injection result.',
    );
  }
  if (result.error === 'NO_AT_TOKEN') {
    throw new FlowBatchPageTransportError(
      'NO_AT_TOKEN',
      'The current Flow page has no WIZ at token. Reload the signed-in Flow project and retry.',
    );
  }

  const status = result.status ?? 0;
  const text = result.text ?? '';
  if (status < 200 || status >= 300) {
    throw new FlowBatchPageTransportError(
      'BATCH_HTTP_ERROR',
      `Flow batch RPC ${options.rpcId} returned HTTP ${status}.`,
      status,
    );
  }

  return {
    status,
    text,
    matched: result.matched,
  };
}
