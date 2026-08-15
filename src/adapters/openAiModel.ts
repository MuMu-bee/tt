import { requestUrl } from 'obsidian';
import type { AgentConfig } from '../data/dashboardTypes';
import type { RequestContext } from '../application/requestContext';
import type { ModelPort } from '../ports/modelPort';
import {
	buildCloudCompletionRequest,
	buildOllamaCompletionRequest,
	extractCloudCompletionContent,
	extractOllamaCompletionContent,
} from '../application/modelCompletions';
import { buildVisionRequest } from '../application/visionCompletions';

/** Human-friendly hint for common HTTP status codes. */
function statusHint(status: number): string {
	if (status === 401 || status === 403) return '，请检查 API Key 是否正确';
	if (status === 402) return '，账户配额或余额不足，请到服务商控制台充值或检查套餐';
	if (status === 404) return '，请检查 API 地址和模型名称是否正确';
	if (status === 429) return '，请求过于频繁，请稍后再试';
	if (status >= 500) return '，服务器错误，请稍后再试';
	return '';
}

/** Rejects with a friendly timeout error if the promise does not settle in time. */
function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = window.setTimeout(() => reject(new Error(`模型响应超时（超过 ${Math.round(milliseconds / 1000)} 秒），可重试`)), milliseconds);
		promise.then(
			(value) => { window.clearTimeout(timer); resolve(value); },
			(error: unknown) => { window.clearTimeout(timer); reject(error instanceof Error ? error : new Error(String(error))); },
		);
	});
}

const GENERATION_TIMEOUT_MS = 180_000;

/**
 * Model adapter that calls the configured cloud (OpenAI-compatible) or local
 * Ollama endpoint through Obsidian's `requestUrl`, which is the only network
 * API available to plugins.
 */
export class OpenAiModel implements ModelPort {
	private readonly config: AgentConfig;

	constructor(config: AgentConfig) {
		this.config = config;
	}

	async generate(prompt: string, _context: RequestContext): Promise<string> {
		const useLocal = this.config.useLocal;
		const request = useLocal
			? buildOllamaCompletionRequest(this.config, prompt)
			: buildCloudCompletionRequest(this.config, prompt);

		let response: Awaited<ReturnType<typeof requestUrl>>;
		try {
			response = await withTimeout(
				requestUrl({
					url: request.url,
					method: request.method,
					headers: request.headers,
					body: request.body,
					throw: false,
				}),
				GENERATION_TIMEOUT_MS,
			);
		} catch (error) {
			if (error instanceof Error && error.message.includes('模型响应超时')) {
				throw error;
			}
			throw new Error('无法连接模型服务，请检查网络和地址配置');
		}

		if (response.status < 200 || response.status >= 300) {
			throw new Error(`API 返回 ${response.status}${statusHint(response.status)}`);
		}

		return useLocal
			? extractOllamaCompletionContent(response.json)
			: extractCloudCompletionContent(response.json);
	}

	async generateVision(prompt: string, imageDataUrl: string, _context: RequestContext): Promise<string> {
		const request = buildVisionRequest(this.config, prompt, imageDataUrl);
		let response: Awaited<ReturnType<typeof requestUrl>>;
		try {
			response = await withTimeout(
				requestUrl({
					url: request.url,
					method: request.method,
					headers: request.headers,
					body: request.body,
					throw: false,
				}),
				GENERATION_TIMEOUT_MS,
			);
		} catch (error) {
			if (error instanceof Error && error.message.includes('模型响应超时')) {
				throw error;
			}
			throw new Error('无法连接模型服务，请检查网络和地址配置');
		}
		if (response.status < 200 || response.status >= 300) {
			throw new Error(`API 返回 ${response.status}${statusHint(response.status)}`);
		}
		return extractCloudCompletionContent(response.json);
	}
}
