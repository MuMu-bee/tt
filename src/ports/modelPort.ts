import type { RequestContext } from '../application/requestContext';

export interface ModelPort {
	/** Generates text for a workbench operation when a model is configured. */
	generate(prompt: string, context: RequestContext): Promise<string>;
}
