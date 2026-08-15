/**
 * Pure vector math helpers for semantic search.
 * 注意：保持无 obsidian 依赖，以便在 node --experimental-strip-types 下测试。
 */

/** L2-normalizes a vector in place of allocation; returns a new array. */
export function normalize(vector: number[]): number[] {
	const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
	if (magnitude === 0 || !Number.isFinite(magnitude)) {
		return vector.map(() => 0);
	}
	return vector.map((value) => value / magnitude);
}

/** Cosine similarity between two equal-length vectors (assumes raw, non-normalized). */
export function cosineSimilarity(a: number[], b: number[]): number {
	if (a.length === 0 || a.length !== b.length) {
		return 0;
	}
	let dot = 0;
	let normA = 0;
	let normB = 0;
	for (let index = 0; index < a.length; index += 1) {
		const valueA = a[index] ?? 0;
		const valueB = b[index] ?? 0;
		dot += valueA * valueB;
		normA += valueA * valueA;
		normB += valueB * valueB;
	}
	const denominator = Math.sqrt(normA) * Math.sqrt(normB);
	if (denominator === 0 || !Number.isFinite(denominator)) {
		return 0;
	}
	return dot / denominator;
}

/** Returns the indices of the top `k` scores (highest first), stable by index. */
export function topK(scores: number[], k: number): number[] {
	const limit = Math.max(0, Math.min(k, scores.length));
	return scores
		.map((score, index) => ({ score, index }))
		.sort((a, b) => b.score - a.score || a.index - b.index)
		.slice(0, limit)
		.map((entry) => entry.index);
}
