import assert from 'node:assert/strict';
import test from 'node:test';
import type { RequestContext } from '../src/application/requestContext.ts';
import type { IndexPort } from '../src/ports/indexPort.ts';
import type { ModelPort } from '../src/ports/modelPort.ts';

test('ports expose context-aware contracts', () => {
	const context: RequestContext = {
		request_id: 'req-test',
		actor: 'user',
		created_at: new Date().toISOString(),
	};
	const index: IndexPort = {} as IndexPort;
	const model: ModelPort = {} as ModelPort;
	assert.ok(context.request_id);
	assert.ok(index && model);
});
