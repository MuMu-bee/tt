import type { RequestContext } from '../application/requestContext';

export type PublishKind = 'diary' | 'inbox' | 'report' | 'lint';

export interface PublishRequest {
	path: string;
	content: string;
	kind: PublishKind;
	overwrite: boolean;
}

export interface PublishedArtifact {
	path: string;
	request_id: string;
}

export interface MemoryPublishPort {
	publish(input: PublishRequest, context: RequestContext): Promise<PublishedArtifact>;
}
