import type { AgentConfig } from '../data/dashboardTypes';

/**
 * Pure helpers for image understanding via a cloud vision model.
 *
 * This module MUST stay free of any obsidian import so it can run under
 * `node --experimental-strip-types` in the test suite. It builds OpenAI-style
 * multimodal request bodies and converts image bytes to base64 data URIs.
 */

export interface VisionCompletionRequest {
	url: string;
	method: string;
	headers: Record<string, string>;
	body: string;
}

export type VisionTask = 'summarize' | 'ocr' | 'diagram';

export const VISION_MAX_BASE64_LENGTH = 10_000_000;

export const VISION_TASK_PROMPTS: Record<VisionTask, string> = {
	summarize: '请用中文详细描述这张图片的内容，包括主体、场景、文字信息和你的理解。输出 Markdown。',
	ocr: '请把这张图片里出现的所有文字原样提取出来，按阅读顺序排列。只输出文字内容，不要解释。',
	diagram: '这是一张图表或示意图。请用中文解读它：它展示的是什么、关键元素有哪些、说明了什么信息。输出 Markdown。',
};

/** Converts raw bytes to a base64 string without stack overflow on large arrays. */
export function byteArrayToBase64(bytes: Uint8Array): string {
	let binary = '';
	const chunkSize = 0x8000;
	for (let offset = 0; offset < bytes.length; offset += chunkSize) {
		binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
	}
	return btoa(binary);
}

/** Maps an image file path to a MIME type, or '' for unsupported extensions. */
export function mimeFromPath(path: string): string {
	const lower = path.toLocaleLowerCase();
	if (lower.endsWith('.png')) return 'image/png';
	if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
	if (lower.endsWith('.webp')) return 'image/webp';
	if (lower.endsWith('.gif')) return 'image/gif';
	return '';
}

/** Builds an OpenAI-compatible multimodal chat completion request. */
export function buildVisionRequest(
	config: AgentConfig,
	prompt: string,
	imageDataUrl: string,
): VisionCompletionRequest {
	const apiKey = config.apiKey.trim();
	if (!apiKey) {
		throw new Error('请在设置中配置云端 API Key');
	}
	const model = config.visionModel.trim();
	if (!model) {
		throw new Error('请在设置中配置视觉模型名称');
	}
	if (imageDataUrl.length > VISION_MAX_BASE64_LENGTH) {
		throw new Error('图片过大，请选择较小的图片');
	}
	const baseUrl = config.baseUrl.trim().replace(/\/+$/, '');
	const body = JSON.stringify({
		model,
		messages: [{
			role: 'user',
			content: [
				{ type: 'text', text: prompt },
				{ type: 'image_url', image_url: { url: imageDataUrl } },
			],
		}],
		max_tokens: 8192,
	});
	return {
		url: baseUrl + '/chat/completions',
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: 'Bearer ' + apiKey,
		},
		body,
	};
}
