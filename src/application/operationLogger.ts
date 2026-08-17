import type { RequestContext } from './requestContext';

/*
 * 注意：当前版本未接入任何调用方（无引用）。保留用于未来"可观测性"
 * 需求接入（搜索/整理/写入统一 request_id 日志）。接入前请勿宣称已启用。
 */
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
