import assert from 'node:assert/strict';
import test from 'node:test';
import type { RequestContext } from '../src/application/requestContext.ts';
import type { IndexPort } from '../src/ports/indexPort.ts';
import type { MemoryPublishPort } from '../src/ports/memoryPublishPort.ts';
import type { ModelPort } from '../src/ports/modelPort.ts';
import type { NetworkPort } from '../src/ports/networkPort.ts';
import type { VaultPort } from '../src/ports/vaultPort.ts';

test('ports expose context-aware contracts', () => {
	const context: RequestContext = {
		request_id: 'req-test',
		actor: 'user',
		created_at: new Date().toISOString(),
	};
	const vault: VaultPort = {} as VaultPort;
	const index: IndexPort = {} as IndexPort;
	const network: NetworkPort = {} as NetworkPort;
	const publisher: MemoryPublishPort = {} as MemoryPublishPort;
	const model: ModelPort = {} as ModelPort;
	assert.ok(context.request_id);
	assert.ok(vault && index && network && publisher && model);
});
