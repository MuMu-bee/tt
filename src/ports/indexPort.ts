import type { RequestContext } from '../application/requestContext';

export type Availability = 'ready' | 'unavailable';

export interface IndexHit {
	path: string;
	title: string;
	snippet: string;
	score: number;
}

export interface IndexPort {
	search(
		query: string,
		options: Record<string, unknown>,
		context: RequestContext,
	): Promise<IndexHit[]>;
	invalidate(path: string, context: RequestContext): Promise<void>;
	availability(): Availability;
}
