import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_AGENT_CONFIG, type AgentConfig } from '../src/data/dashboardTypes.ts';
import {
	buildVisionRequest,
	byteArrayToBase64,
	mimeFromPath,
	VISION_MAX_BASE64_LENGTH,
	VISION_TASK_PROMPTS,
} from '../src/application/visionCompletions.ts';

function config(overrides: Partial<AgentConfig> = {}): AgentConfig {
	return { ...DEFAULT_AGENT_CONFIG, ...overrides };
}

test('byteArrayToBase64 encodes bytes correctly', () => {
	const bytes = new Uint8Array([104, 101, 108, 108, 111]); // "hello"
	assert.equal(byteArrayToBase64(bytes), 'aGVsbG8=');
});

test('mimeFromPath maps supported image extensions', () => {
	assert.equal(mimeFromPath('a.png'), 'image/png');
	assert.equal(mimeFromPath('a.JPG'), 'image/jpeg');
	assert.equal(mimeFromPath('a.jpeg'), 'image/jpeg');
	assert.equal(mimeFromPath('a.webp'), 'image/webp');
	assert.equal(mimeFromPath('a.gif'), 'image/gif');
});

test('mimeFromPath returns empty for unsupported extensions', () => {
	assert.equal(mimeFromPath('a.pdf'), '');
	assert.equal(mimeFromPath('a.md'), '');
});

test('vision request uses configured vision model and multimodal content', () => {
	const req = buildVisionRequest(
		config({ apiKey: 'sk-test', visionModel: 'step-1o-turbo-vision', baseUrl: 'https://api.stepfun.com/step_plan/v1' }),
		'describe',
		'data:image/png;base64,abc',
	);
	assert.equal(req.url, 'https://api.stepfun.com/step_plan/v1/chat/completions');
	assert.equal(req.headers.Authorization, 'Bearer sk-test');
	const body = JSON.parse(req.body) as {
		model: string;
		max_tokens: number;
		messages: Array<{ content: Array<{ type: string; image_url?: { url: string }; text?: string }> }>;
	};
	assert.equal(body.model, 'step-1o-turbo-vision');
	assert.equal(body.max_tokens, 8192);
	const content = body.messages[0]?.content;
	assert.ok(content);
	assert.equal(content[0]?.type, 'text');
	assert.equal(content[1]?.type, 'image_url');
	assert.equal(content[1]?.image_url?.url, 'data:image/png;base64,abc');
});

test('vision request without api key throws', () => {
	assert.throws(() => buildVisionRequest(config({ apiKey: '', visionModel: 'v' }), 'p', 'data:image/png;base64,x'), /配置云端 API Key/);
});

test('vision request without vision model throws', () => {
	assert.throws(() => buildVisionRequest(config({ apiKey: 'sk' }), 'p', 'data:image/png;base64,x'), /配置视觉模型名称/);
});

test('vision request rejects oversized images', () => {
	const huge = 'data:image/png;base64,' + 'a'.repeat(VISION_MAX_BASE64_LENGTH + 1);
	assert.throws(() => buildVisionRequest(config({ apiKey: 'sk', visionModel: 'v' }), 'p', huge), /图片过大/);
});

test('vision task prompts cover summarize, ocr and diagram', () => {
	assert.ok(VISION_TASK_PROMPTS.summarize.includes('描述'));
	assert.ok(VISION_TASK_PROMPTS.ocr.includes('文字'));
	assert.ok(VISION_TASK_PROMPTS.diagram.includes('图表'));
});
