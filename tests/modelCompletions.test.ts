import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_AGENT_CONFIG, type AgentConfig } from '../src/data/dashboardTypes.ts';
import {
	buildCloudCompletionRequest,
	buildOllamaCompletionRequest,
	extractCloudCompletionContent,
	extractOllamaCompletionContent,
} from '../src/application/modelCompletions.ts';

function config(overrides: Partial<AgentConfig> = {}): AgentConfig {
	return { ...DEFAULT_AGENT_CONFIG, ...overrides };
}

test('cloud request carries bearer auth, model, messages and max_tokens', () => {
	const req = buildCloudCompletionRequest(config({ apiKey: 'sk-test', model: 'step-1-flash' }), 'hello');
	assert.equal(req.url, 'https://api.stepfun.com/v1/chat/completions');
	assert.equal(req.method, 'POST');
	assert.equal(req.headers.Authorization, 'Bearer sk-test');
	const body = JSON.parse(req.body) as {
		model: string;
		messages: Array<{ role: string; content: string }>;
		max_tokens: number;
	};
	assert.equal(body.model, 'step-1-flash');
	assert.equal(body.messages[0]?.role, 'user');
	assert.equal(body.messages[0]?.content, 'hello');
	assert.equal(body.max_tokens, 8192);
});

test('cloud request without api key throws a friendly error', () => {
	assert.throws(() => buildCloudCompletionRequest(config({ apiKey: '' }), 'hello'), /配置云端 API Key/);
});

test('cloud request strips trailing slashes from base url', () => {
	const req = buildCloudCompletionRequest(config({ apiKey: 'sk', baseUrl: 'https://example.com/v1/' }), 'hi');
	assert.equal(req.url, 'https://example.com/v1/chat/completions');
});

test('ollama request uses local url, model and non-streaming', () => {
	const req = buildOllamaCompletionRequest(
		config({ ollamaUrl: 'http://localhost:11434/', ollamaModel: 'qwen3:8b' }),
		'hi',
	);
	assert.equal(req.url, 'http://localhost:11434/api/chat');
	assert.equal(req.method, 'POST');
	const body = JSON.parse(req.body) as {
		model: string;
		stream: boolean;
		messages: Array<{ role: string; content: string }>;
	};
	assert.equal(body.model, 'qwen3:8b');
	assert.equal(body.stream, false);
	assert.equal(body.messages[0]?.content, 'hi');
});

test('extract cloud content from choices message', () => {
	const data = { choices: [{ message: { content: ' 结果 ' } }] };
	assert.equal(extractCloudCompletionContent(data), ' 结果 ');
});

test('extract cloud content throws when empty or missing', () => {
	assert.throws(() => extractCloudCompletionContent({ choices: [{ message: { content: '' } }] }), /空内容/);
	assert.throws(() => extractCloudCompletionContent({}), /空内容/);
});

test('extract cloud content hints when only reasoning was produced', () => {
	const data = { choices: [{ message: { content: '', reasoning_content: '思考了很久' } }] };
	assert.throws(() => extractCloudCompletionContent(data), /思考过长/);
});

test('extract ollama content from message', () => {
	assert.equal(extractOllamaCompletionContent({ message: { content: 'ok' } }), 'ok');
});

test('extract ollama content throws when empty', () => {
	assert.throws(() => extractOllamaCompletionContent({ message: { content: '' } }), /空内容/);
});
