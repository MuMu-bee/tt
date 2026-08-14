import type { AgentConfig } from '../data/dashboardTypes';

/**
 * Pure helpers that build model completion requests and extract responses.
 * 注意：保持无 obsidian 依赖，以便在 node --experimental-strip-types 下测试。
 */

export interface ModelCompletionRequest {
	url: string;
	method: string;
	headers: Record<string, string>;
	body: string;
}

/** Builds an OpenAI-compatible `/chat/completions` request body. */
export function buildCloudCompletionRequest(
	config: AgentConfig,
	prompt: string,
): ModelCompletionRequest {
	const apiKey = config.apiKey.trim();
	if (!apiKey) {
		throw new Error('请在设置中配置云端 API Key');
	}
	const baseUrl = config.baseUrl.trim().replace(/\/+$/, '');
	if (!baseUrl) {
		throw new Error('请在设置中配置云端 API 地址');
	}
	const model = config.model.trim();
	if (!model) {
		throw new Error('请在设置中配置云端模型名称');
	}
	const body = JSON.stringify({
		model,
		messages: [{ role: 'user', content: prompt }],
		max_tokens: 8192,
	});
	return {
		url: `${baseUrl}/chat/completions`,
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${apiKey}`,
		},
		body,
	};
}

/** Builds a local Ollama `/api/chat` request body (non-streaming). */
export function buildOllamaCompletionRequest(
	config: AgentConfig,
	prompt: string,
): ModelCompletionRequest {
	const baseUrl = config.ollamaUrl.trim().replace(/\/+$/, '');
	if (!baseUrl) {
		throw new Error('请在设置中配置 Ollama 地址');
	}
	const model = config.ollamaModel.trim() || config.model.trim();
	if (!model) {
		throw new Error('请在设置中配置 Ollama 模型名称');
	}
	const body = JSON.stringify({
		model,
		messages: [{ role: 'user', content: prompt }],
		stream: false,
	});
	return {
		url: `${baseUrl}/api/chat`,
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body,
	};
}

/** Extracts `choices[0].message.content` from an OpenAI-compatible response. */
export function extractCloudCompletionContent(data: unknown): string {
	const record = data as {
		choices?: Array<{
			message?: { content?: unknown; reasoning_content?: unknown };
		}>;
	};
	const message = record?.choices?.[0]?.message;
	const content = message?.content;
	if (typeof content === 'string' && content.trim() !== '') {
		return content;
	}
	const reasoning = message?.reasoning_content;
	if (typeof reasoning === 'string' && reasoning.trim() !== '') {
		throw new Error('模型思考过长，未生成正式回复（可重试或换用非推理模型）');
	}
	throw new Error('API 返回了空内容');
}

/** Extracts `message.content` from an Ollama chat response. */
export function extractOllamaCompletionContent(data: unknown): string {
	const record = data as { message?: { content?: unknown } };
	const content = record?.message?.content;
	if (typeof content !== 'string' || content.trim() === '') {
		throw new Error('Ollama 返回了空内容');
	}
	return content;
}
