import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequestContext, createRequestId } from '../src/application/requestContext.ts';

test('request identifiers are unique and context metadata is valid', () => {
	const firstId = createRequestId();
	const secondId = createRequestId();
	assert.notEqual(firstId, secondId);
	const context = createRequestContext('user', firstId);
	assert.equal(context.request_id.length > 0, true);
	assert.equal(context.actor, 'user');
	assert.equal(context.parent_request_id, firstId);
	assert.doesNotThrow(() => new Date(context.created_at).toISOString());
});
