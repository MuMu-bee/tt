export type RequestActor = 'user' | 'workbench-agent' | 'background-task';

export interface RequestContext {
	request_id: string;
	actor: RequestActor;
	created_at: string;
	parent_request_id?: string;
	child?: () => RequestContext;
}

/** Creates a request context for one observable operation. */
export function createRequestContext(
	actor: RequestActor = 'user',
	parentRequestId?: string,
): RequestContext {
	const context: RequestContext = {
		request_id: createRequestId(),
		actor,
		created_at: new Date().toISOString(),
	};
	if (parentRequestId) {
		context.parent_request_id = parentRequestId;
	}
	context.child = (): RequestContext => createRequestContext(context.actor, context.request_id);
	return context;
}

/** Creates a UUID request identifier with a standards-compliant fallback. */
export function createRequestId(): string {
	const cryptoObject = globalThis.crypto;
	if (typeof cryptoObject?.randomUUID === 'function') {
		return cryptoObject.randomUUID();
	}
	return `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
