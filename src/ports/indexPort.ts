import type { RequestContext } from '../application/requestContext';

export type Availability = 'ready' | 'unavailable';

export interface IndexHit {
	path: string;
	title: string;
	snippet: string;
	score: number;
	matched_fields?: string[];
	source?: 'keyword';
	raw_hash?: string;
	open_path?: string;
}

export interface IndexPort {
	search(
		query: string,
		options: Record<string, unknown>,
		context: RequestContext,
	): Promise<IndexHit[]>;
	invalidate(path: string, context: RequestContext): Promise<void>;
	availability(): Availability;
	refresh?(paths: string[], context: RequestContext): Promise<import('../application/contracts').RefreshStatus>;
	rebuild?(context: RequestContext): Promise<import('../application/contracts').RefreshStatus>;
	health?(context: RequestContext): Promise<import('../application/contracts').Health>;
	getGraphData?(): { nodes: Array<{ id: string; title: string; type: string; degree: number }>; edges: Array<{ source: string; target: string }>; stats: { nodeCount: number; edgeCount: number; isolatedCount: number } };
}
