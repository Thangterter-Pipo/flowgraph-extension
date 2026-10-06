import { describe, it, expect } from 'vitest';
import { ApprovalGate } from '../../src/runtime/approval/ApprovalGate';
import type { CreditEstimator, RenderPlan } from '../../src/runtime/approval/types';

const MIN = 60 * 1000;

function setup(creditPerScene = 20) {
  let t = 1_700_000_000_000;
  const clock = { now: () => t, advance: (ms: number) => (t += ms) };
  const price = { perScene: creditPerScene };
  const estimator: CreditEstimator = { estimate: (p) => p.scenes.length * price.perScene };
  const gate = new ApprovalGate({ estimator, now: clock.now });
  return { gate, clock, price };
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

async function approve(gate: ApprovalGate, plan: RenderPlan) {
  const proposal = await gate.propose(plan);
  return gate.grant(proposal.proposalId);
}

async function expectCode(p: Promise<unknown>, code: string) {
  try {
    await p;
  } catch (e) {
    expect((e as { code?: string }).code).toBe(code);
    return;
  }
  throw new Error(`Mong đợi lỗi ${code} nhưng lệnh đã thành công`);
}

describe('ApprovalGate', () => {
  it('đổi token lấy batch khi nội dung khớp, receipt ghi đúng credit và cảnh', async () => {
    const { gate } = setup();
    const plan = makePlan();
    const tk = await approve(gate, plan);
    const batch = await gate.redeem(plan, tk.token);
    expect(batch.receipt.credits).toBe(40);
    expect(batch.receipt.sceneIds.join(',')).toBe('S01,S02');
    expect(batch.receipt.planHash).toBe(tk.planHash);
  });

  it('token chỉ dùng được một lần', async () => {
    const { gate } = setup();
    const plan = makePlan();
    const tk = await approve(gate, plan);
    await gate.redeem(plan, tk.token);
    await expectCode(gate.redeem(plan, tk.token), 'TOKEN_ALREADY_USED');
  });

  it('hai lệnh song song cùng token: đúng một lệnh thành công', async () => {
    const { gate } = setup();
    const plan = makePlan();
    const tk = await approve(gate, plan);
    const results = await Promise.allSettled([gate.redeem(plan, tk.token), gate.redeem(plan, tk.token)]);
    expect(results.filter((r) => r.status === 'fulfilled').length).toBe(1);
  });

  it('hết hạn sau 5 phút kể từ lúc duyệt', async () => {
    const { gate, clock } = setup();
    const plan = makePlan();
    const tk = await approve(gate, plan);
    clock.advance(5 * MIN);
    await expectCode(gate.redeem(plan, tk.token), 'TOKEN_EXPIRED');
  });

  it('còn hạn ở phút thứ 4', async () => {
    const { gate, clock } = setup();
    const plan = makePlan();
    const tk = await approve(gate, plan);
    clock.advance(4 * MIN);
    const batch = await gate.redeem(plan, tk.token);
    expect(batch.receipt.credits).toBe(40);
  });

  it('đổi prompt / model / thêm cảnh / đổi thứ tự đều bị PLAN_MISMATCH, token không bị đốt', async () => {
    const { gate } = setup();
    const plan = makePlan();
    const tk = await approve(gate, plan);

    const editedPrompt = makePlan();
    (editedPrompt.scenes[0] as { prompt: string }).prompt += ' (thêm chi tiết)';
    await expectCode(gate.redeem(editedPrompt, tk.token), 'PLAN_MISMATCH');

    await expectCode(gate.redeem({ ...makePlan(), model: 'veo-3.1-quality' }, tk.token), 'PLAN_MISMATCH');

    const extra = makePlan();
    await expectCode(
      gate.redeem(
        { ...extra, scenes: [...extra.scenes, { sceneId: 'S03', nodeType: 't2v', prompt: 'x', durationSec: 8 }] },
        tk.token,
      ),
      'PLAN_MISMATCH',
    );

    const reordered = makePlan();
    await expectCode(gate.redeem({ ...reordered, scenes: [...reordered.scenes].reverse() }, tk.token), 'PLAN_MISMATCH');

    // Đúng kế hoạch đã duyệt vẫn chạy được
    const batch = await gate.redeem(plan, tk.token);
    expect(batch.receipt.sceneIds.length).toBe(2);
  });

  it('giá đổi sau khi duyệt => PLAN_MISMATCH (gate tự tính lại credit)', async () => {
    const { gate, price } = setup(20);
    const plan = makePlan();
    const tk = await approve(gate, plan);
    price.perScene = 30;
    await expectCode(gate.redeem(plan, tk.token), 'PLAN_MISMATCH');
  });

  it('trường UI không thuộc kế hoạch không làm đổi hash', async () => {
    const { gate } = setup();
    const plan = makePlan();
    const tk = await approve(gate, plan);
    const withUiFields = {
      model: plan.model,
      scenes: plan.scenes.map((s) => ({ ...s, position: { x: 10, y: 20 }, color: 'red' })),
    } as RenderPlan;
    const batch = await gate.redeem(withUiFields, tk.token);
    expect(batch.receipt.planHash).toBe(tk.planHash);
  });

  it('sửa object gốc sau khi gọi redeem không làm đổi nội dung batch', async () => {
    const { gate } = setup();
    const plan = makePlan();
    const tk = await approve(gate, plan);
    const pending = gate.redeem(plan, tk.token);
    (plan.scenes[0] as { prompt: string }).prompt = 'NỘI DUNG BỊ TRÁO';
    const batch = await pending;
    expect(batch.plan.scenes[0].prompt).toBe('Mèo phi hành gia bước ra khỏi tàu');
  });

  it('thiếu token / token lạ', async () => {
    const { gate } = setup();
    await expectCode(gate.redeem(makePlan(), undefined), 'TOKEN_MISSING');
    await expectCode(gate.redeem(makePlan(), 'fgat_khong_ton_tai'), 'TOKEN_UNKNOWN');
  });

  it('kế hoạch không hợp lệ bị từ chối ngay từ propose', async () => {
    const { gate } = setup();
    await expectCode(gate.propose({ model: 'veo-3.1-fast', scenes: [] }), 'INVALID_PLAN');
    const dup = makePlan();
    await expectCode(gate.propose({ ...dup, scenes: [dup.scenes[0], dup.scenes[0]] }), 'INVALID_PLAN');
  });

  it('không duyệt hai lần, không duyệt đề xuất hết hạn', async () => {
    const { gate, clock } = setup();
    const p1 = await gate.propose(makePlan());
    gate.grant(p1.proposalId);
    let err = '';
    try { gate.grant(p1.proposalId); } catch (e) { err = (e as { code: string }).code; }
    expect(err).toBe('PROPOSAL_NOT_PENDING');

    const p2 = await gate.propose(makePlan());
    clock.advance(5 * MIN);
    try { gate.grant(p2.proposalId); } catch (e) { err = (e as { code: string }).code; }
    expect(err).toBe('PROPOSAL_EXPIRED');
  });

  it('awaitDecision trả token khi người dùng duyệt, trả rejected khi từ chối', async () => {
    const { gate } = setup();
    const p1 = await gate.propose(makePlan());
    const waiting = gate.awaitDecision(p1.proposalId, 1000);
    const tk = gate.grant(p1.proposalId);
    const d1 = await waiting;
    expect(d1.status).toBe('granted');
    expect(d1.status === 'granted' && d1.token.token === tk.token).toBe(true);

    const p2 = await gate.propose(makePlan());
    const waiting2 = gate.awaitDecision(p2.proposalId, 1000);
    gate.reject(p2.proposalId);
    expect((await waiting2).status).toBe('rejected');
  });
});
