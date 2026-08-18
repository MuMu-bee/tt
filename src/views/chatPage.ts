import type { ChatService } from '../services/chatService';

export interface ChatPageHost {
	chatService?: ChatService;
	chatMessagesEl: HTMLElement | null;
	isClosed(): boolean;
	registerDomEvent: (el: HTMLElement, type: string, callback: (event: Event) => void) => void;
	getErrorMessage: (error: unknown) => string;
}

export function renderChatPage(host: ChatPageHost, parent: HTMLElement): void {
	const card = parent.createEl('section', {
		cls: 'agent-dashboard-surface agent-dashboard-chat-card',
		attr: { 'aria-label': '对话' },
	});
	const header = card.createDiv({ cls: 'agent-dashboard-surface-header' });
	const heading = header.createDiv();
	heading.createSpan({ cls: 'agent-dashboard-eyebrow', text: '💬 CHAT' });
	heading.createEl('h2', { text: '对话' });
	heading.createEl('p', { text: '墨忆台助手：会引用 Vault 里相关的笔记回答你。需在设置中配置模型（云端 API 或本地 Ollama）。' });

	const clearBtn = header.createEl('button', { cls: 'agent-dashboard-subtle-button', attr: { type: 'button' } });
	clearBtn.createSpan({ text: '清空对话' });
	host.registerDomEvent(clearBtn, 'click', () => {
		host.chatService?.clearMessages();
		host.chatMessagesEl?.empty();
		appendChatWelcome(host);
	});

	const messageList = card.createDiv({ cls: 'agent-dashboard-chat-messages' });
	host.chatMessagesEl = messageList;
	appendChatWelcome(host);

	const inputArea = card.createDiv({ cls: 'agent-dashboard-chat-input-area' });
	const input = inputArea.createEl('input', {
		cls: 'agent-dashboard-chat-input',
		attr: { type: 'text', placeholder: '输入你的问题…（回车发送）', 'aria-label': '输入消息' },
	});
	const sendBtn = inputArea.createEl('button', {
		cls: 'agent-dashboard-chat-send-btn',
		attr: { type: 'button', 'aria-label': '发送' },
	});
	sendBtn.createSpan({ text: '发送' });
	const stopBtn = inputArea.createEl('button', {
		cls: 'agent-dashboard-chat-send-btn',
		attr: { type: 'button', 'aria-label': '停止生成' },
	});
	stopBtn.createSpan({ text: '停止' });
	stopBtn.hidden = true;

	host.registerDomEvent(sendBtn, 'click', () => void handleChatSend(host, input, sendBtn, stopBtn));
	host.registerDomEvent(input, 'keydown', (event: Event) => {
		const keyboardEvent = event as KeyboardEvent;
		if (keyboardEvent.key === 'Enter' && !keyboardEvent.shiftKey) {
			keyboardEvent.preventDefault();
			void handleChatSend(host, input, sendBtn, stopBtn);
		}
	});
	host.registerDomEvent(stopBtn, 'click', () => {
		host.chatService?.stop();
		stopBtn.hidden = true;
		sendBtn.disabled = false;
	});
}

function appendChatWelcome(host: ChatPageHost): void {
	if (!host.chatMessagesEl) return;
	const msg = host.chatMessagesEl.createDiv({ cls: 'agent-dashboard-chat-message agent-dashboard-chat-message--assistant' });
	msg.createSpan({ text: '你好！我是墨忆台助手。问我关于你笔记的问题吧。' });
}

function appendChatMessage(host: ChatPageHost, role: 'user' | 'assistant', text: string): void {
	if (!host.chatMessagesEl) return;
	const msg = host.chatMessagesEl.createDiv({ cls: 'agent-dashboard-chat-message agent-dashboard-chat-message--' + role });
	msg.createSpan({ text });
	host.chatMessagesEl.scrollTop = host.chatMessagesEl.scrollHeight;
}

async function handleChatSend(host: ChatPageHost, input: HTMLInputElement, sendBtn: HTMLButtonElement, stopBtn: HTMLButtonElement): Promise<void> {
	const text = input.value.trim();
	if (!text) return;
	if (!host.chatService) {
		appendChatMessage(host, 'assistant', '对话服务未初始化，请重启插件后再试。');
		return;
	}
	input.value = '';
	sendBtn.disabled = true;
	appendChatMessage(host, 'user', text);

	const assistantEl = host.chatMessagesEl?.createDiv({ cls: 'agent-dashboard-chat-message agent-dashboard-chat-message--assistant' });
	const contentEl = assistantEl?.createSpan();
	contentEl?.setText('思考中…');
	stopBtn.hidden = false;

	const unsubscribe = host.chatService.on((event) => {
		if (host.isClosed() || !contentEl) return;
		if (event.type === 'delta') {
			const current = contentEl.getText();
			contentEl.setText((current === '思考中…' ? '' : current) + (event.content ?? ''));
			if (host.chatMessagesEl) host.chatMessagesEl.scrollTop = host.chatMessagesEl.scrollHeight;
		} else if (event.type === 'references' && event.references && event.references.length > 0 && assistantEl) {
			const refs = event.references.slice(0, 3).map((ref) => ref.title).join('、');
			assistantEl.createDiv({ cls: 'agent-dashboard-chat-refs', text: '📎 引用笔记：' + refs });
		} else if (event.type === 'error') {
			contentEl.setText('抱歉，出了点问题：' + (event.error ?? '未知错误'));
		}
	});

	try {
		await host.chatService.sendMessage(text);
	} catch (error) {
		if (contentEl) contentEl.setText('抱歉，出了点问题：' + host.getErrorMessage(error));
	} finally {
		unsubscribe();
		stopBtn.hidden = true;
		sendBtn.disabled = false;
	}
}
