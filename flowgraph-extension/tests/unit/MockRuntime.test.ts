import { describe, it, expect } from 'vitest';
import { MockRuntime } from '../mocks/mock-runtime';
import type { ApiResult } from '../../src/shared/bridge-types';
import type { RenderPlan } from '../../src/shared/approval-types';
import { RUNTIME_API_METHODS } from '../../src/shared/bridge-types';

function must<T>(r: ApiResult<T>): T {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.value;
}

function expectErr<T>(r: ApiResult<T>, code: string) {
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error.code).toBe(code);
}

function makePlan(): RenderPlan {
  return {
    model: 'veo-3.1-fast',
    scenes: [
      { sceneId: 'S01', nodeType: 'i2v', prompt: 'Mèo phi hành gia bước ra khỏi tàu', durationSec: 8, imageArtifactId: 'stitch-idb:cat' },
      { sceneId: 'S02', nodeType: 'i2v', prompt: 'Mèo nhìn về chân trời sao Hỏa', durationSec: 7, imageArtifactId: 'stitch-idb:cat' },
    ],
  };
}

/** propose -> người dùng duyệt -> lấy token, như agent thật sẽ làm. */
async function getToken(mock: MockRuntime, plan: RenderPlan): Promise<string> {
  const proposal = must(await mock.proposeRender(plan));
  const decision = must(await mock.awaitApproval(proposal.proposalId, 1000));
  if (decision.status !== 'granted') throw new Error(`Không được duyệt: ${decision.status}`);
  return decision.token.token;
}

describe('MockRuntime: luồng duyệt credit', () => {
  it('chưa duyệt thì không render được và không tốn credit', async () => {
    const mock = new MockRuntime();
    expectErr(await mock.submitRender({ plan: makePlan() }), 'TOKEN_MISSING');
    expectErr(await mock.submitRender({ plan: makePlan(), approvalToken: 'fgat_bia' }), 'TOKEN_UNKNOWN');
    expect(mock.submissions.length).toBe(0);
    expect(mock.creditsSpent).toBe(0);
    expect(mock.creditsRemaining).toBe(1000);
  });

  it('đường đi đúng: propose -> duyệt -> submit -> done, artifact là stitch-idb', async () => {
    const mock = new MockRuntime({ approval: 'auto-approve' });
    const plan = makePlan();
    const token = await getToken(mock, plan);
    const { batchId, credits } = must(await mock.submitRender({ plan, approvalToken: token }));
    expect(credits).toBe(40);
    expect(mock.creditsRemaining).toBe(960);

    const status = must(await mock.getRenderStatus(batchId));
    expect(status.state).toBe('done');
    const artifacts = must(await mock.listArtifacts());
    expect(artifacts.length).toBe(2);
    expect(artifacts.every((a) => a.artifactId.startsWith('stitch-idb:'))).toBe(true);
  });

  it('policy manual: awaitApproval chờ tới khi người dùng bấm Duyệt', async () => {
    const mock = new MockRuntime({ approval: 'manual' });
    const proposal = must(await mock.proposeRender(makePlan()));
    const waiting = mock.awaitApproval(proposal.proposalId, 1000);
    mock.user.approve(proposal.proposalId);
    const decision = must(await waiting);
    expect(decision.status).toBe('granted');
  });

  it('người dùng từ chối: không có token, submit thất bại', async () => {
    const mock = new MockRuntime({ approval: 'auto-reject' });
    const proposal = must(await mock.proposeRender(makePlan()));
    const decision = must(await mock.awaitApproval(proposal.proposalId, 1000));
    expect(decision.status).toBe('rejected');
    expectErr(await mock.submitRender({ plan: makePlan() }), 'TOKEN_MISSING');
    expect(mock.submissions.length).toBe(0);
  });

  it('token dùng lại bị chặn, credit chỉ trừ một lần', async () => {
    const mock = new MockRuntime({ approval: 'auto-approve' });
    const plan = makePlan();
    const token = await getToken(mock, plan);
    must(await mock.submitRender({ plan, approvalToken: token }));
    expectErr(await mock.submitRender({ plan, approvalToken: token }), 'TOKEN_ALREADY_USED');
    expect(mock.submissions.length).toBe(1);
    expect(mock.creditsSpent).toBe(40);
  });

  it('sửa kế hoạch sau khi duyệt bị PLAN_MISMATCH', async () => {
    const mock = new MockRuntime({ approval: 'auto-approve' });
    const plan = makePlan();
    const token = await getToken(mock, plan);
    const edited = { ...plan, model: 'veo-3.1-quality' };
    expectErr(await mock.submitRender({ plan: edited, approvalToken: token }), 'PLAN_MISMATCH');
    expect(mock.submissions.length).toBe(0);
  });

  it('giá đổi sau khi duyệt => phải duyệt lại', async () => {
    const mock = new MockRuntime({ approval: 'auto-approve' });
    const plan = makePlan();
    const token = await getToken(mock, plan);
    mock.setPrice('veo-3.1-fast', 35);
    expectErr(await mock.submitRender({ plan, approvalToken: token }), 'PLAN_MISMATCH');
  });

  it('không đủ credit thì chặn ngay từ propose', async () => {
    const mock = new MockRuntime({ creditBalance: 30 });
    expectErr(await mock.proposeRender(makePlan()), 'INSUFFICIENT_CREDITS');
  });
});

describe('MockRuntime: bất biến và Flow', () => {
  it('cảnh video dài hơn 8s bị chặn trước khi xin duyệt', async () => {
    const mock = new MockRuntime();
    const plan = makePlan();
    const long: RenderPlan = { ...plan, scenes: [{ ...plan.scenes[0], sceneId: 'S01', durationSec: 15 }] };
    expectErr(await mock.proposeRender(long), 'INVARIANT_VIOLATION');
  });

  it('prompt quá 2000 ký tự hoặc imageArtifactId là URL đều bị chặn', async () => {
    const mock = new MockRuntime();
    const plan = makePlan();
    expectErr(
      await mock.proposeRender({ ...plan, scenes: [{ ...plan.scenes[0], prompt: 'x'.repeat(2001) }] }),
      'INVARIANT_VIOLATION',
    );
    expectErr(
      await mock.proposeRender({ ...plan, scenes: [{ ...plan.scenes[0], imageArtifactId: 'https://cdn.example/tmp.png' }] }),
      'INVARIANT_VIOLATION',
    );
  });

  it('Flow kẹt captcha: fail-fast và KHÔNG đốt token; hết captcha thì chạy lại được', async () => {
    const mock = new MockRuntime({ approval: 'auto-approve' });
    const plan = makePlan();
    const token = await getToken(mock, plan);

    mock.setFlow({ captcha: true });
    expectErr(await mock.submitRender({ plan, approvalToken: token }), 'CAPTCHA_BLOCKED');
    expect(mock.submissions.length).toBe(0);

    mock.setFlow({ captcha: false });
    must(await mock.submitRender({ plan, approvalToken: token }));
    expect(mock.submissions.length).toBe(1);
  });

  it('tab Flow chưa gắn debugger: FLOW_UNAVAILABLE', async () => {
    const mock = new MockRuntime({ flow: { attached: false } });
    expectErr(await mock.proposeRender(makePlan()), 'FLOW_UNAVAILABLE');
  });

  it('cảnh lỗi được inject: status failed và log có mã lỗi gốc', async () => {
    const mock = new MockRuntime({
      approval: 'auto-approve',
      failScenes: { S02: { code: 'FLOW_POLICY_BLOCKED', message: 'Prompt bị Flow từ chối' } },
    });
    const plan = makePlan();
    const token = await getToken(mock, plan);
    const { batchId } = must(await mock.submitRender({ plan, approvalToken: token }));

    const status = must(await mock.getRenderStatus(batchId));
    expect(status.state).toBe('failed');
    expect(status.scenes[0].status).toBe('done');
    expect(status.scenes[1].status).toBe('failed');

    const log = must(await mock.readCdpLog({ minLevel: 'error' }));
    expect(log.length).toBe(1);
    expect(log[0].code).toBe('FLOW_POLICY_BLOCKED');
  });

  it('render thủ công: running cho tới khi completeAll', async () => {
    const mock = new MockRuntime({ approval: 'auto-approve', autoCompleteRender: false });
    const plan = makePlan();
    const token = await getToken(mock, plan);
    const { batchId } = must(await mock.submitRender({ plan, approvalToken: token }));
    expect(must(await mock.getRenderStatus(batchId)).state).toBe('running');
    mock.completeAll(batchId);
    expect(must(await mock.getRenderStatus(batchId)).state).toBe('done');
  });
});

describe('MockRuntime: đồ thị', () => {
  it('tạo node, nối dây hợp lệ, xóa node kéo theo xóa dây', async () => {
    const mock = new MockRuntime();
    const p = must(await mock.createNode({ kind: 'prompt', params: { prompt: 'Mèo trên sao Hỏa' } })).node;
    const t = must(await mock.createNode({ kind: 't2v', params: { durationSec: 8 } })).node;
    const edge = must(await mock.connectEdge({ kind: 'PROMPT', source: p.id, target: t.id })).edge;

    const removed = must(await mock.deleteNode(p.id));
    expect(removed.removedEdgeIds.join(',')).toBe(edge.id);
    expect(must(await mock.readGraph()).edges.length).toBe(0);
  });

  it('chặn dây sai kiểu, node không tồn tại, dây trùng', async () => {
    const mock = new MockRuntime();
    const p = must(await mock.createNode({ kind: 'prompt' })).node;
    const i = must(await mock.createNode({ kind: 'i2v' })).node;
    expectErr(await mock.connectEdge({ kind: 'VIDEO', source: p.id, target: i.id }), 'INVALID_EDGE');
    expectErr(await mock.connectEdge({ kind: 'PROMPT', source: p.id, target: 'node-999' }), 'NODE_NOT_FOUND');
    must(await mock.connectEdge({ kind: 'PROMPT', source: p.id, target: i.id }));
    expectErr(await mock.connectEdge({ kind: 'PROMPT', source: p.id, target: i.id }), 'INVALID_EDGE');
  });

  it('chặn chu trình', async () => {
    const mock = new MockRuntime();
    const a = must(await mock.createNode({ kind: 'videoConcat' })).node;
    const b = must(await mock.createNode({ kind: 'videoConcat' })).node;
    must(await mock.connectEdge({ kind: 'VIDEO', source: a.id, target: b.id }));
    expectErr(await mock.connectEdge({ kind: 'VIDEO', source: b.id, target: a.id }), 'CYCLE_DETECTED');
    expectErr(await mock.connectEdge({ kind: 'VIDEO', source: a.id, target: a.id }), 'CYCLE_DETECTED');
  });

  it('node video > 8s bị chặn khi tạo và khi sửa', async () => {
    const mock = new MockRuntime();
    expectErr(await mock.createNode({ kind: 't2v', params: { durationSec: 30 } }), 'INVARIANT_VIOLATION');
    const n = must(await mock.createNode({ kind: 'i2v', params: { durationSec: 8 } })).node;
    expectErr(await mock.updateNode(n.id, { params: { durationSec: 12 } }), 'INVARIANT_VIOLATION');
    expect(must(await mock.readGraph()).nodes[0].params.durationSec).toBe(8);
  });

  it('REVISION_CONFLICT khi canvas đã đổi sau lần đọc', async () => {
    const mock = new MockRuntime();
    const rev = must(await mock.readGraph()).revision;
    must(await mock.createNode({ kind: 'prompt' }));
    expectErr(await mock.createNode({ kind: 'prompt' }, { expectedRevision: rev }), 'REVISION_CONFLICT');
  });

  it('readGraph trả bản sao: sửa kết quả không làm đổi trạng thái bên trong', async () => {
    const mock = new MockRuntime();
    must(await mock.createNode({ kind: 'prompt', params: { prompt: 'gốc' } }));
    const snap = must(await mock.readGraph());
    snap.nodes[0].params.prompt = 'bị sửa ngoài';
    expect(must(await mock.readGraph()).nodes[0].params.prompt).toBe('gốc');
  });
});

describe('MockRuntime: hợp đồng với RuntimeApi', () => {
  it('ghi lại lịch sử gọi để eval assert, và không có grant/reject trong bề mặt agent', async () => {
    const mock = new MockRuntime();
    await mock.readGraph();
    await mock.submitRender({ plan: makePlan() });
    expect(mock.calls.map((c) => c.method).join(',')).toBe('readGraph,submitRender');
    expect(mock.calls[1].errorCode).toBe('TOKEN_MISSING');

    const names = RUNTIME_API_METHODS as readonly string[];
    expect(names.includes('grant')).toBe(false);
    expect(names.includes('reject')).toBe(false);
    for (const m of names) expect(typeof (mock as unknown as Record<string, unknown>)[m]).toBe('function');
  });
});
