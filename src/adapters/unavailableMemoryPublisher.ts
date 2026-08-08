import type { RequestContext } from '../application/requestContext';
import type {
	MemoryPublishPort,
	PublishedArtifact,
	PublishRequest,
} from '../ports/memoryPublishPort';

/** Explicit no-op external publishing adapter used until configured. */
export class UnavailableMemoryPublisher implements MemoryPublishPort {
	async publish(
		_input: PublishRequest,
		_context: RequestContext,
	): Promise<PublishedArtifact> {
		throw new Error('动态记忆发布适配器不可用。');
	}
}
