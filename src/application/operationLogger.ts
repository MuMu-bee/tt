import type { RequestContext } from './requestContext';

export type OperationStatus = 'started' | 'succeeded' | 'failed';

export interface OperationLog {
	request_id: string;
	actor: RequestContext['actor'];
	operation: string;
	status: OperationStatus;
	created_at: string;
	duration_ms?: number;
	error_code?: string;
}

export interface OperationLogger {
	log(entry: OperationLog): void;
}

/** Logger implementation that emits structured records without note contents. */
export class ConsoleOperationLogger implements OperationLogger {
	log(entry: OperationLog): void {
		console.debug('[agent-dashboard]', JSON.stringify(entry));
	}
}

/** Runs an operation with start/success/failure observability. */
export async function withOperation<T>(
	logger: OperationLogger,
	context: RequestContext,
	operation: string,
	action: () => Promise<T>,
): Promise<T> {
	const startedAt = Date.now();
	logger.log({
		request_id: context.request_id,
		actor: context.actor,
		operation,
		status: 'started',
		created_at: context.created_at,
	});
	try {
		const result = await action();
		logger.log({
			request_id: context.request_id,
			actor: context.actor,
			operation,
			status: 'succeeded',
			created_at: context.created_at,
			duration_ms: Date.now() - startedAt,
		});
		return result;
	} catch (error) {
		logger.log({
			request_id: context.request_id,
			actor: context.actor,
			operation,
			status: 'failed',
			created_at: context.created_at,
			duration_ms: Date.now() - startedAt,
			error_code: error instanceof Error ? error.name : 'unknown-error',
		});
		throw error;
	}
}
