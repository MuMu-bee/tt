import { requestUrl } from 'obsidian';
import type { AgentConfig } from '../data/dashboardTypes';
import type { RequestContext } from '../application/requestContext';
import type { EmbeddingPort } from '../ports/embeddingPort';
import type { Health } from '../application/contracts';

/**
 * Local embedding adapter backed by Ollama's `/api/embed` endpoint, with a
 * legacy `/api/embeddings` fallback for older Ollama versions.
 */
export class OllamaEmbedding implements EmbeddingPort {
	private readonly config: AgentConfig;

	constructor(config: AgentConfig) {
		this.config = config;
	}

	async embed(texts: string[], _context: RequestContext): Promise<number[][]> {
		const baseUrl = this.config.ollamaUrl.trim().replace(/\/+$/, '');
		if (!baseUrl) {
			throw new Error('请在设置中配置 Ollama 地址');
		}
		const model = this.config.ollamaEmbeddingModel.trim() || this.config.ollamaModel.trim();
		if (!model) {
			throw new Error('请在设置中配置 Embedding 模型名称');
		}
		if (texts.length === 0) {
			return [];
		}

		// New /api/embed supports batched input.
		try {
			const response = await requestUrl({
				url: `${baseUrl}/api/embed`,
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ model, input: texts }),
				throw: false,
			});
			if (response.status >= 200 && response.status < 300) {
				const data = response.json as { embeddings?: unknown };
				if (Array.isArray(data.embeddings)) {
					const embeddings = data.embeddings.map((item) => this.asVector(item));
					if (embeddings.length === texts.length) {
						return embeddings;
					}
				}
			}
		} catch {
			// Fall through to the legacy one-by-one path below.
		}

		// Legacy /api/embeddings fallback.
		const results: number[][] = [];
		for (const text of texts) {
			const response = await requestUrl({
				url: `${baseUrl}/api/embeddings`,
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ model, prompt: text }),
				throw: false,
			});
			if (response.status < 200 || response.status >= 300) {
				throw new Error(
					`Ollama 返回 ${response.status}，请检查 Ollama 是否运行、Embedding 模型是否已安装`,
				);
			}
			const data = response.json as { embedding?: unknown };
			const vector = this.asVector(data.embedding);
			if (vector.length === 0) {
				throw new Error('Ollama 返回了空向量');
			}
			results.push(vector);
		}
		return results;
	}

	async health(_context: RequestContext): Promise<Health> {
		const baseUrl = this.config.ollamaUrl.trim().replace(/\/+$/, '');
		const model = this.config.ollamaEmbeddingModel.trim() || this.config.ollamaModel.trim();
		try {
			const response = await requestUrl({
				url: `${baseUrl}/api/tags`,
				method: 'GET',
				throw: false,
			});
			if (response.status < 200 || response.status >= 300) {
				return {
					available: false,
					status: 'unavailable',
					reason: `Ollama 返回 ${response.status}`,
					provider: 'ollama',
				};
			}
			const data = response.json as { models?: Array<{ name?: unknown }> };
			const names = Array.isArray(data.models)
				? data.models
					.filter((item): item is { name: string } => typeof item?.name === 'string')
					.map((item) => item.name)
				: [];
			const installed = names.some(
				(name) => name === model || name.startsWith(`${model}:`),
			);
			if (!installed) {
				return {
					available: false,
					status: 'unavailable',
					reason: `Ollama 中未安装模型 ${model}，请先运行 ollama pull ${model}`,
					provider: 'ollama',
				};
			}
			return { available: true, status: 'healthy', provider: 'ollama' };
		} catch {
			return {
				available: false,
				status: 'unavailable',
				reason: '无法连接 Ollama，请确认已启动',
				provider: 'ollama',
			};
		}
	}

	private asVector(value: unknown): number[] {
		if (!Array.isArray(value)) {
			return [];
		}
		return value.map((item) => (typeof item === 'number' && Number.isFinite(item) ? item : 0));
	}
}
