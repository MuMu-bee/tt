import type { RequestContext } from '../application/requestContext';
import type { ModelPort } from '../ports/modelPort';

/** Explicit no-op model adapter used until a model provider is configured. */
export class UnavailableModel implements ModelPort {
	async generate(_prompt: string, _context: RequestContext): Promise<string> {
		throw new Error('当前未配置工作台模型。');
	}
}
