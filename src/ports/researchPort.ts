import type { RequestContext } from '../application/requestContext.ts';

/** Research task status. */
export type ResearchTaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

/** A single research task. */
export interface ResearchTask {
	taskId: string;
	query: string;
	status: ResearchTaskStatus;
	createdAt: string;
	completedAt?: string;
	result?: ResearchResult;
	error?: string;
}

/** Result of a research operation. */
export interface ResearchResult {
	summary: string;
	sources: ResearchSource[];
	reportPath?: string;
}

/** A single source referenced during research. */
export interface ResearchSource {
	url: string;
	title: string;
	snippet: string;
	fetchedAt: string;
	provider: string;
}

/** Port for background research operations. */
export interface ResearchPort {
	submit(query: string, context: RequestContext): Promise<string>;
	getStatus(taskId: string, context: RequestContext): Promise<ResearchTask | null>;
	cancel(taskId: string, context: RequestContext): Promise<void>;
	list(context: RequestContext): Promise<ResearchTask[]>;
}