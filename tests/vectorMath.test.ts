import assert from 'node:assert/strict';
import test from 'node:test';
import { cosineSimilarity, normalize, topK } from '../src/application/vectorMath.ts';

test('cosine similarity returns 1 for identical vectors', () => {
	assert.equal(cosineSimilarity([1, 2, 3], [1, 2, 3]), 1);
});

test('cosine similarity returns 0 for orthogonal vectors', () => {
	assert.ok(Math.abs(cosineSimilarity([1, 0], [0, 1])) < 1e-12);
});

test('cosine similarity returns 0 for zero or mismatched vectors', () => {
	assert.equal(cosineSimilarity([0, 0], [0, 0]), 0);
	assert.equal(cosineSimilarity([1, 2], [1]), 0);
	assert.equal(cosineSimilarity([], [1]), 0);
});

test('cosine similarity orders aligned vectors above unrelated ones', () => {
	const aligned = cosineSimilarity([1, 1], [1, 1]);
	const unrelated = cosineSimilarity([1, 1], [1, -1]);
	assert.ok(aligned > unrelated);
});

test('normalize produces a unit vector', () => {
	const normalized = normalize([3, 4]);
	const magnitude = Math.sqrt(normalized[0] ** 2 + normalized[1] ** 2);
	assert.ok(Math.abs(magnitude - 1) < 1e-12);
});

test('normalize zero vector returns zeros', () => {
	assert.deepEqual(normalize([0, 0]), [0, 0]);
});

test('topK returns highest scoring indices in order', () => {
	assert.deepEqual(topK([0.1, 0.9, 0.5], 2), [1, 2]);
	assert.deepEqual(topK([0.9, 0.1, 0.5], 1), [0]);
	assert.deepEqual(topK([], 3), []);
	assert.deepEqual(topK([0.3, 0.3], 2), [0, 1]);
});
