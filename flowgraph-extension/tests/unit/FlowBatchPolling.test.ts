import { describe, expect, it } from 'vitest';
import {
  FLOW_BATCH_RPC,
} from '../../src/adapters/google-flow/batch/FlowBatchProtocol';
import {
  FlowBatchVideoPoller,
  type FlowBatchRpcExecutor,
} from '../../src/adapters/google-flow/batch/FlowBatchPolling';

const PROJECT = '11111111-2222-3333-4444-555555555555';
const OPERATION = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const MEDIA = '12345678-1234-1234-1234-1234567890ab';
const IMAGE_URL = `https://flow-content.google/image/${MEDIA}?sig=poster`;
const VIDEO_URL = `https://flow-content.google/video/${MEDIA}?sig=video`;

function envelope(rpcId: string, payload: unknown): string {
  const chunk = JSON.stringify([['wrb.fr', rpcId, JSON.stringify(payload)]]);
  return `)]}'\n${chunk.length}\n${chunk}\n`;
}

function operationPayload(status?: string, complaint?: string): unknown {
  const detail = complaint
    ? [null, null, null, null, null, null, null, null, [4, [null, complaint]]]
    : null;
  return [null, 50, [[OPERATION, PROJECT, 'scene', status ?? null, null, detail]]];
}

class FakeExecutor implements FlowBatchRpcExecutor {
  readonly calls: Array<{ rpcId: string; match?: string }> = [];
  readonly responses = new Map<string, string | ((options?: { match?: string }) => string)>();

  async run(rpcId: string, _fReq: string, options?: { match?: string }): Promise<string> {
    this.calls.push({ rpcId, match: options?.match });
    const response = this.responses.get(rpcId);
    if (typeof response === 'function') return response(options);
    if (typeof response === 'string') return response;
    throw new Error(`No fake response for ${rpcId}`);
  }
}

describe('FlowBatchVideoPoller', () => {
  it('reports success only after the media record contains a real video URL', async () => {
    const executor = new FakeExecutor();
    executor.responses.set(FLOW_BATCH_RPC.OPERATION, envelope(
      FLOW_BATCH_RPC.OPERATION,
      operationPayload('CAE'),
    ));
    executor.responses.set(
      FLOW_BATCH_RPC.PROJECT_MEDIA,
      `["${OPERATION}",null,null,["title",1,2,null,null,"${MEDIA}"]]`,
    );
    executor.responses.set(
      FLOW_BATCH_RPC.MEDIA,
      envelope(FLOW_BATCH_RPC.MEDIA, [IMAGE_URL, VIDEO_URL]),
    );

    const poller = new FlowBatchVideoPoller(executor);
    const result = await poller.pollOperation(OPERATION, PROJECT);

    expect(result).toMatchObject({
      status: 'SUCCESSFUL',
      operationId: OPERATION,
      projectId: PROJECT,
      mediaId: MEDIA,
      url: VIDEO_URL,
      posterUrl: IMAGE_URL,
    });
  });

  it('keeps a poster-only media record pending', async () => {
    const executor = new FakeExecutor();
    executor.responses.set(FLOW_BATCH_RPC.OPERATION, envelope(
      FLOW_BATCH_RPC.OPERATION,
      operationPayload('CAE'),
    ));
    executor.responses.set(
      FLOW_BATCH_RPC.PROJECT_MEDIA,
      `["${OPERATION}",null,null,["title",1,2,null,null,"${MEDIA}"]]`,
    );
    executor.responses.set(
      FLOW_BATCH_RPC.MEDIA,
      envelope(FLOW_BATCH_RPC.MEDIA, [IMAGE_URL]),
    );

    const result = await new FlowBatchVideoPoller(executor).pollOperation(OPERATION, PROJECT);
    expect(result.status).toBe('PENDING');
    expect(result.mediaId).toBe(MEDIA);
    expect(result.posterUrl).toBe(IMAGE_URL);
    expect(result.url).toBeUndefined();
  });

  it('carries a survivable operation complaint instead of failing the job', async () => {
    const executor = new FakeExecutor();
    executor.responses.set(FLOW_BATCH_RPC.OPERATION, envelope(
      FLOW_BATCH_RPC.OPERATION,
      operationPayload(undefined, 'Media not found.'),
    ));
    executor.responses.set(FLOW_BATCH_RPC.PROJECT_MEDIA, 'no matching operation');

    const result = await new FlowBatchVideoPoller(executor).pollOperation(OPERATION, PROJECT);
    expect(result.status).toBe('PENDING');
    expect(result.complaint).toContain('Media not found.');
  });

  it('consults the expensive project listing every third quiet poll', async () => {
    const executor = new FakeExecutor();
    executor.responses.set(FLOW_BATCH_RPC.OPERATION, envelope(
      FLOW_BATCH_RPC.OPERATION,
      operationPayload(),
    ));
    executor.responses.set(
      FLOW_BATCH_RPC.PROJECT_MEDIA,
      `["${OPERATION}",null,null,["title",1,2,null,null,"${MEDIA}"]]`,
    );
    executor.responses.set(
      FLOW_BATCH_RPC.MEDIA,
      envelope(FLOW_BATCH_RPC.MEDIA, [VIDEO_URL]),
    );

    const poller = new FlowBatchVideoPoller(executor);
    expect((await poller.pollOperation(OPERATION, PROJECT)).status).toBe('PENDING');
    expect((await poller.pollOperation(OPERATION, PROJECT)).status).toBe('PENDING');
    expect(executor.calls.filter((call) => call.rpcId === FLOW_BATCH_RPC.PROJECT_MEDIA)).toHaveLength(0);

    expect((await poller.pollOperation(OPERATION, PROJECT)).status).toBe('SUCCESSFUL');
    const listingCalls = executor.calls.filter((call) => call.rpcId === FLOW_BATCH_RPC.PROJECT_MEDIA);
    expect(listingCalls).toHaveLength(1);
    expect(listingCalls[0].match).toBe(OPERATION);
  });

  it('caches operation -> mediaId and skips operation/listing on later rounds', async () => {
    const executor = new FakeExecutor();
    executor.responses.set(FLOW_BATCH_RPC.OPERATION, envelope(
      FLOW_BATCH_RPC.OPERATION,
      operationPayload('CAE'),
    ));
    executor.responses.set(
      FLOW_BATCH_RPC.PROJECT_MEDIA,
      `["${OPERATION}",null,null,["title",1,2,null,null,"${MEDIA}"]]`,
    );
    executor.responses.set(
      FLOW_BATCH_RPC.MEDIA,
      envelope(FLOW_BATCH_RPC.MEDIA, [IMAGE_URL]),
    );

    const poller = new FlowBatchVideoPoller(executor);
    await poller.pollOperation(OPERATION, PROJECT);
    executor.calls.length = 0;

    await poller.pollOperation(OPERATION, PROJECT);
    expect(executor.calls.map((call) => call.rpcId)).toEqual([FLOW_BATCH_RPC.MEDIA]);
  });

  it('supports direct media-id polling for workflow-backed text video', async () => {
    const executor = new FakeExecutor();
    executor.responses.set(
      FLOW_BATCH_RPC.MEDIA,
      envelope(FLOW_BATCH_RPC.MEDIA, [VIDEO_URL]),
    );

    const result = await new FlowBatchVideoPoller(executor).pollMedia(MEDIA, PROJECT);
    expect(result).toMatchObject({
      status: 'SUCCESSFUL',
      projectId: PROJECT,
      mediaId: MEDIA,
      url: VIDEO_URL,
    });
  });
});
