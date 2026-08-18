import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequestContext } from '../src/application/requestContext.ts';
import type { JsonlTextStorage } from '../src/adapters/jsonlStorage.ts';
import type { Proposal } from '../src/application/contracts.ts';
import { JsonlProposalStore } from '../src/adapters/jsonlProposalStore.ts';
import { JsonlApprovalStore } from '../src/adapters/jsonlApprovalStore.ts';

class MemoryJsonlStorage implements JsonlTextStorage {
  private content = '';
  constructor(initial = '') { this.content = initial; }
  async read() { return this.content; }
  async write(value: string) { this.content = value; }
  get() { return this.content; }
}

function proposal(id: string): Proposal {
  return {
    proposal_id: id,
    request_id: 'req-' + id,
    target_path: 'notes/a.md',
    target_zone: 'normal',
    change_kind: 'tag-add',
    base_hash: 'hash-before',
    before: 'before',
    after: 'after',
    diff: '+tag',
    reason: 'test',
    created_at: new Date().toISOString(),
    status: 'approved',
    requires_approval: true,
    schema_version: 1,
  };
}

test('jsonl proposal/approval stores survive a simulated restart and keep status', async () => {
  const context = createRequestContext('workbench-agent');
  /* Phase 1: 写入记录（各 store 使用独立文件，与生产一致） */
  const proposalStorage = new MemoryJsonlStorage();
  const approvalStorage = new MemoryJsonlStorage();
  {
    const proposals = new JsonlProposalStore(proposalStorage);
    const approvals = new JsonlApprovalStore(approvalStorage);
    await proposals.save(proposal('p1'), context);
    await approvals.save({ approval_id: 'ap1', proposal_id: 'p1', request_id: 'req-p1', decision: 'approve', actor: 'user', decided_at: new Date().toISOString() }, context);
  }
  /* Phase 2: 模拟重启——用同一文件内容新建 store 实例并 restore */
  const proposals2 = new JsonlProposalStore(new MemoryJsonlStorage(proposalStorage.get()));
  const approvals2 = new JsonlApprovalStore(new MemoryJsonlStorage(approvalStorage.get()));
  const report = await proposals2.restore(context);
  assert.equal(report.loaded, true);
  const restored = await proposals2.get('p1', context);
  assert.ok(restored);
  /* 状态不回退：approved 保持 approved */
  assert.equal(restored.status, 'approved');
  const approval = await approvals2.getForProposal('p1', context);
  assert.ok(approval);
  assert.equal(approval.decision, 'approve');
});
