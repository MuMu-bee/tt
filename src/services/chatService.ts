import { requestUrl } from 'obsidian';
import type { AgentConfig, ChatMessage, ChatReference } from '../data/dashboardTypes';
import { VaultContextService } from './vaultContext';

/**
 * 对话服务（含 Vault 上下文注入的流式 LLM 对话）。
 * 注意：当前版本对话页（AgentDashboardView 的「对话」页）尚未接入本服务，
 * 发送消息实际走深度研究（AgentActionService.runDeepResearch）。接入前请勿
 * 宣称本服务为生产对话链路。
 */
/** 注入 API 的最近对话条数上限。 */
const HISTORY_WINDOW = 20;

const SYSTEM_PROMPT = `你是墨忆台，住在用户 Obsidian 知识库里的私人智能助手。

你的性格：像一个靠谱的朋友。说话简洁、有人味，不啰嗦。会主动关联用户之前记过的东西。
你不只是回答问题——你会帮用户管理知识库、整理笔记、做研究。

当 Vault 中有相关笔记时，你会自然地引用它们，比如"你之前在 XX 笔记里记过这个"。
如果没有找到相关笔记，就正常回答，不要硬扯。

回答用中文，保持简洁。`;

export type ChatEventType = 'delta' | 'complete' | 'error' | 'references';

export interface ChatEvent {
	type: ChatEventType;
	content?: string;
	references?: ChatReference[];
	error?: string;
}

export type ChatListener = (event: ChatEvent) => void;

export class ChatService {
	private messages: ChatMessage[] = [];
	private listeners: ChatListener[] = [];
	private abortController: AbortController | null = null;

	constructor(
		private readonly config: AgentConfig,
		private readonly vaultContext: VaultContextService,
	) {}

	/** Update config at runtime (e.g. when user changes settings). */
	updateConfig(config: AgentConfig): void {
		Object.assign(this.config, config);
	}

	/** Get current message history. */
	getMessages(): ChatMessage[] {
		return [...this.messages];
	}

	/** Clear message history. */
	clearMessages(): void {
		this.messages = [];
	}

	/** Subscribe to chat events. */
	on(listener: ChatListener): () => void {
		this.listeners.push(listener);
		return () => {
			this.listeners = this.listeners.filter((l) => l !== listener);
		};
	}

	/** Stop current streaming. */
	stop(): void {
		this.abortController?.abort();
		this.abortController = null;
	}

	/**
	 * Send a user message and get a response.
	 * Automatically searches vault for context and injects it.
	 */
	async sendMessage(content: string): Promise<void> {
		const userMessage: ChatMessage = {
			id: this.generateId(),
			role: 'user',
			content,
			timestamp: new Date().toISOString(),
		};
		this.messages.push(userMessage);

		// Search vault for relevant context
		let references: ChatReference[] = [];
		let vaultContext = '';
		try {
			references = await this.vaultContext.search(content);
			if (references.length > 0) {
				vaultContext = this.vaultContext.buildContext(
					references,
					this.config.maxContextTokens,
				);
				this.emit({ type: 'references', references });
			}
		} catch {
			// Context search failure shouldn't block the chat
		}

		// Build messages for API
		const apiMessages = this.buildApiMessages(vaultContext);

		// Create assistant message placeholder
		const assistantMessage: ChatMessage = {
			id: this.generateId(),
			role: 'assistant',
			content: '',
			timestamp: new Date().toISOString(),
			references,
			streaming: true,
		};
		this.messages.push(assistantMessage);

		try {
			await this.callLLM(apiMessages, assistantMessage);
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : '请求失败';
			assistantMessage.content = `抱歉，出了点问题：${errorMsg}`;
			assistantMessage.streaming = false;
			this.emit({ type: 'error', error: errorMsg });
		}

		assistantMessage.streaming = false;
		this.emit({ type: 'complete', content: assistantMessage.content });
	}

	/**
	 * Call the LLM API (cloud or local).
	 */
	private async callLLM(
		apiMessages: Array<{ role: string; content: string }>,
		assistantMessage: ChatMessage,
	): Promise<void> {
		this.abortController = new AbortController();

		if (this.config.useLocal) {
			await this.callOllama(apiMessages, assistantMessage);
		} else {
			await this.callCloudAPI(apiMessages, assistantMessage);
		}
	}

	/**
	 * Call cloud OpenAI-compatible API with streaming.
	 */
	private async callCloudAPI(
		apiMessages: Array<{ role: string; content: string }>,
		assistantMessage: ChatMessage,
	): Promise<void> {
		if (!this.config.apiKey) {
			throw new Error('请在设置中配置云端 API Key');
		}

		const url = `${this.config.baseUrl.replace(/\/+$/, '')}/chat/completions`;

		// Try streaming first, fall back to non-streaming.
		// 用户停止导致的 AbortError 不得降级重试：重试会重新发起一个无法再被停止的完整请求。
		try {
			await this.streamCloudAPI(url, apiMessages, assistantMessage);
		} catch (error) {
			if (isAbortError(error)) {
				throw error;
			}
			// If streaming fails for another reason, try non-streaming
			await this.nonStreamCloudAPI(url, apiMessages, assistantMessage);
		}
	}

	private async streamCloudAPI(
		url: string,
		apiMessages: Array<{ role: string; content: string }>,
		assistantMessage: ChatMessage,
	): Promise<void> {
		const response = await fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${this.config.apiKey}`,
			},
			body: JSON.stringify({
				model: this.config.model,
				messages: apiMessages,
				stream: true,
				max_tokens: 2048,
			}),
			signal: this.abortController?.signal,
		});

		if (!response.ok) {
			throw new Error(`API 返回 ${response.status}`);
		}

		const reader = response.body?.getReader();
		if (!reader) {
			throw new Error('无法读取响应流');
		}

		const decoder = new TextDecoder();
		let buffer = '';

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split('\n');
			buffer = lines.pop() ?? '';

			for (const line of lines) {
				const trimmed = line.trim();
				if (!trimmed || !trimmed.startsWith('data: ')) continue;
				const data = trimmed.slice(6);
				if (data === '[DONE]') return;

				try {
					const parsed = JSON.parse(data) as {
						choices?: Array<{ delta?: { content?: string } }>;
					};
					const delta = parsed.choices?.[0]?.delta?.content;
					if (delta) {
						assistantMessage.content += delta;
						this.emit({ type: 'delta', content: delta });
					}
				} catch {
					// Skip malformed chunks
				}
			}
		}
	}

	private async nonStreamCloudAPI(
		url: string,
		apiMessages: Array<{ role: string; content: string }>,
		assistantMessage: ChatMessage,
	): Promise<void> {
		const response = await requestUrl({
			url,
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${this.config.apiKey}`,
			},
			body: JSON.stringify({
				model: this.config.model,
				messages: apiMessages,
				max_tokens: 2048,
			}),
		});

		const data = response.json as {
			choices?: Array<{ message?: { content?: string } }>;
		};
		const content = data.choices?.[0]?.message?.content;
		if (content) {
			assistantMessage.content = content;
			this.emit({ type: 'delta', content });
		} else {
			throw new Error('API 返回了空内容');
		}
	}

	/**
	 * Call local Ollama API.
	 */
	private async callOllama(
		apiMessages: Array<{ role: string; content: string }>,
		assistantMessage: ChatMessage,
	): Promise<void> {
		const url = `${this.config.ollamaUrl.replace(/\/+$/, '')}/api/chat`;

		const response = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				model: this.config.ollamaModel,
				messages: apiMessages,
				stream: true,
			}),
			signal: this.abortController?.signal,
		});

		if (!response.ok) {
			throw new Error(`Ollama 返回 ${response.status}，请检查 Ollama 是否运行中`);
		}

		const reader = response.body?.getReader();
		if (!reader) {
			throw new Error('无法读取 Ollama 响应');
		}

		const decoder = new TextDecoder();
		let buffer = '';

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split('\n');
			buffer = lines.pop() ?? '';

			for (const line of lines) {
				if (!line.trim()) continue;
				try {
					const parsed = JSON.parse(line) as {
						message?: { content?: string };
					};
					const delta = parsed.message?.content;
					if (delta) {
						assistantMessage.content += delta;
						this.emit({ type: 'delta', content: delta });
					}
				} catch {
					// Skip malformed lines
				}
			}
		}
	}

	/**
	 * Build API message array with system prompt and vault context.
	 */
	private buildApiMessages(
		vaultContext: string,
	): Array<{ role: string; content: string }> {
		const messages: Array<{ role: string; content: string }> = [];

		// System prompt
		let systemContent = SYSTEM_PROMPT;
		if (vaultContext) {
			systemContent += '\n\n' + vaultContext;
		}
		messages.push({ role: 'system', content: systemContent });

		// Conversation history (last 20 messages to keep context manageable)
		const recentMessages = this.messages.slice(-HISTORY_WINDOW);
		for (const msg of recentMessages) {
			if (msg.role === 'system') continue;
			messages.push({ role: msg.role, content: msg.content });
		}

		return messages;
	}

	private emit(event: ChatEvent): void {
		for (const listener of this.listeners) {
			try {
				listener(event);
			} catch {
				// Don't let listener errors break the chat
			}
		}
	}

	private generateId(): string {
		return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
	}
}

/** Detect fetch/stream aborts (DOMException in Electron, Error in Node). */
function isAbortError(error: unknown): boolean {
	return (
		typeof error === 'object' &&
		error !== null &&
		(error as { name?: unknown }).name === 'AbortError'
	);
}
