import { describe, expect, it } from 'vitest';
import {
  FLOW_BATCH_CAPTCHA_SLOT,
  FLOW_BATCH_RPC,
  FlowBatchRpcError,
  buildFlowImageRequest,
  buildFlowFirstFrameVideoRequest,
  buildFlowTextVideoRequest,
  firstFlowBatchPayload,
  parseFlowBatchEnvelope,
  readFlowGeneratedImages,
  readFlowMediaUrls,
  readFlowTextVideoSubmit,
  resolveFlowImageAspect,
  resolveFlowFirstLastModelKey,
  resolveFlowVideoAspect,
} from '../../src/adapters/google-flow/batch/FlowBatchProtocol';

const PROJECT = '11111111-2222-3333-4444-555555555555';
const MEDIA = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function idFactory() {
  let i = 0;
  return () => `00000000-0000-4000-8000-${String(++i).padStart(12, '0')}`;
}

function responseEnvelope(rpcId: string, payload: unknown): string {
  const chunk = JSON.stringify([['wrb.fr', rpcId, JSON.stringify(payload)]]);
  return `)]}'\n${chunk.length}\n${chunk}\n`;
}

describe('FlowBatchProtocol golden wire', () => {
  it('locks the captured single-image request shape byte-for-byte', () => {
    const actual = buildFlowImageRequest({
      prompt: 'a cat',
      projectId: PROJECT,
      model: 'GEM_PIX_2',
      aspect: '9:16',
      seed: 42,
      referenceMediaIds: [MEDIA],
      idFactory: idFactory(),
    });

    const expected =
      '[[["ogiZ0b","[null,[[null,null,[[\\\"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee\\\",null,null,null,1]],42,2,\\\"GEM_PIX_2\\\",null,[null,22,null,null,null,\\\"11111111-2222-3333-4444-555555555555\\\",null,null,null,null,[\\\"__CAPTCHA__\\\",1]],[[[\\\"a cat\\\"]]],null,null,null,\\\"00000000-0000-4000-8000-000000000001\\\",\\\"00000000-0000-4000-8000-000000000002\\\"]],1,[null,22,null,null,null,\\\"11111111-2222-3333-4444-555555555555\\\",null,null,null,null,[\\\"__CAPTCHA__\\\",1]],[\\\"00000000-0000-4000-8000-000000000003\\\"]]","null","generic"]]]'
        .replace('"null"', 'null');

    expect(actual).toBe(expected);
    expect(actual).toContain(FLOW_BATCH_CAPTCHA_SLOT);
  });

  it('locks the text-to-video positional payload', () => {
    const actual = buildFlowTextVideoRequest({
      prompt: 'a cat walks',
      projectId: PROJECT,
      model: 'abra_t2v_8s',
      aspect: '9:16',
      idFactory: idFactory(),
    });

    const expected =
      '[[["YhhmEf","[[[[null,null,[[[\\\"a cat walks\\\"]]]],\\\"abra_t2v_8s\\\",1,null,[null,null,null,null,\\\"00000000-0000-4000-8000-000000000001\\\",\\\"00000000-0000-4000-8000-000000000002\\\"]]],[null,22,null,null,null,\\\"11111111-2222-3333-4444-555555555555\\\",null,null,null,null,[\\\"__CAPTCHA__\\\",1]],[\\\"00000000-0000-4000-8000-000000000003\\\",1]]","null","generic"]]]'
        .replace('"null"', 'null');

    expect(actual).toBe(expected);
  });

  it('locks the first-frame video positional payload', () => {
    const actual = buildFlowFirstFrameVideoRequest({
      prompt: 'a cat walks',
      projectId: PROJECT,
      sourceMediaId: MEDIA,
      model: 'veo_3_1_i2v_lite_low_priority',
      aspect: '9:16',
      idFactory: idFactory(),
    });

    const expected =
      '[[["eb1hJf","[[[[null,null,[[[\\\"a cat walks\\\"]]]],\\\"veo_3_1_i2v_lite_low_priority\\\",1,null,[null,\\\"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee\\\",null,null,null,[null,0.0038759689922481244,1,0.9961240310077519]],[null,null,null,null,\\\"00000000-0000-4000-8000-000000000001\\\",\\\"00000000-0000-4000-8000-000000000002\\\"]]],[null,22,null,null,null,\\\"11111111-2222-3333-4444-555555555555\\\",null,null,null,null,[\\\"__CAPTCHA__\\\",1]],[\\\"00000000-0000-4000-8000-000000000003\\\",2]]","null","generic"]]]'
        .replace('"null"', 'null');

    expect(actual).toBe(expected);
  });
});

describe('FlowBatchProtocol codec and readers', () => {

  it('maps FlowGraph interpolation registry keys to the current First+Last wire model', () => {
    expect(resolveFlowFirstLastModelKey('abra_i2v_4s')).toBe('omni_flash_i2v_4s_first_last');
    expect(resolveFlowFirstLastModelKey('abra_i2v_8s_360p')).toBe('omni_flash_i2v_8s_first_last_360p');
    expect(resolveFlowFirstLastModelKey('omni_flash_i2v_6s_first_last')).toBe('omni_flash_i2v_6s_first_last');
  });

  it('keeps image and video aspect encodings separate', () => {
    expect(resolveFlowImageAspect('1:1')).toBe(1);
    expect(resolveFlowImageAspect('9:16')).toBe(2);
    expect(resolveFlowImageAspect('16:9')).toBe(3);
    expect(resolveFlowImageAspect('3:4')).toBe(4);
    expect(resolveFlowImageAspect('4:3')).toBe(5);

    expect(resolveFlowVideoAspect('9:16')).toBe(1);
    expect(resolveFlowVideoAspect('16:9')).toBe(2);
  });

  it('parses wrb.fr envelopes and surfaces RPC errors', () => {
    const good = responseEnvelope(FLOW_BATCH_RPC.GENERATE_IMAGE, [['ok']]);
    expect(parseFlowBatchEnvelope(good)).toEqual([
      { rpcId: FLOW_BATCH_RPC.GENERATE_IMAGE, data: [['ok']] },
    ]);
    expect(firstFlowBatchPayload(good, FLOW_BATCH_RPC.GENERATE_IMAGE)).toEqual([['ok']]);

    const errorChunk = JSON.stringify([['wrb.fr', FLOW_BATCH_RPC.GENERATE_IMAGE, null, null, null, [8]]]);
    const bad = `)]}'\n${errorChunk.length}\n${errorChunk}\n`;
    expect(() => firstFlowBatchPayload(bad, FLOW_BATCH_RPC.GENERATE_IMAGE)).toThrow(FlowBatchRpcError);
  });

  it('reads workflow-backed text-video submit media ids without inventing an operation id', () => {
    const payload = [null, null, null, [[MEDIA, PROJECT, 'workflow-1', 'PENDING']]];
    expect(readFlowTextVideoSubmit(payload)).toEqual({
      mediaId: MEDIA,
      projectId: PROJECT,
      workflowId: 'workflow-1',
      status: 'PENDING',
    });
  });

  it('extracts media ids from flow-content.google URLs', () => {
    const imageUrl = `https://flow-content.google/image/${MEDIA}?sig=x`;
    const videoUrl = `https://flow-content.google/video/${MEDIA}?sig=y`;

    expect(readFlowGeneratedImages([imageUrl, imageUrl])).toEqual([{ mediaId: MEDIA, url: imageUrl }]);
    expect(readFlowMediaUrls([imageUrl, videoUrl], MEDIA)).toEqual({
      mediaId: MEDIA,
      image: imageUrl,
      video: videoUrl,
    });
  });
});