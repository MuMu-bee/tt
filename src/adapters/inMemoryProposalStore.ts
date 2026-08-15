import type { RequestContext } from '../application/requestContext.ts';
import type { Proposal, ProposalFilter, ProposalStatus } from '../application/contracts.ts';
import type { ProposalStore } from '../ports/proposalPort.ts';

const terminal: ProposalStatus[] = ['rejected', 'applied', 'conflict', 'expired'];
export class InMemoryProposalStore implements ProposalStore {
  private readonly records = new Map<string, Proposal>();
  async save(proposal: Proposal, _context: RequestContext): Promise<void> { if (!proposal.proposal_id) throw new Error('proposal_id required'); this.records.set(proposal.proposal_id, { ...proposal }); }
  async get(proposalId: string, _context: RequestContext): Promise<Proposal | null> { const value = this.records.get(proposalId); return value ? { ...value } : null; }
  async list(filter: ProposalFilter, _context: RequestContext): Promise<Proposal[]> { return [...this.records.values()].filter((p) => (!filter.status || p.status === filter.status) && (!filter.target_path || p.target_path === filter.target_path) && (!filter.request_id || p.request_id === filter.request_id)).map((p) => ({ ...p })); }
  async updateStatus(proposalId: string, status: ProposalStatus, _context: RequestContext): Promise<void> { const current = this.records.get(proposalId); if (!current) throw new Error('proposal not found'); if (terminal.includes(current.status) && current.status !== status) throw new Error(`terminal proposal cannot transition: ${current.status}`); this.records.set(proposalId, { ...current, status }); }
}
