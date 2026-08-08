import { App, Modal, Notice } from 'obsidian';
import { showActionError } from '../services/agentActionService';

export class InboxIngestModal extends Modal {
	constructor(
		app: App,
		private readonly onSubmit: (content: string) => Promise<string>,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle('导入 inbox');
		const input = this.contentEl.createEl('textarea', {
			attr: {
				placeholder: '输入要保存到 inbox 的内容',
				rows: '7',
				'aria-label': 'Inbox 内容',
			},
		});
		input.addClass('agent-dashboard-inbox-input');

		const actions = this.contentEl.createDiv({ cls: 'agent-dashboard-modal-actions' });
		const cancel = actions.createEl('button', { type: 'button', text: '取消' });
		const submit = actions.createEl('button', { type: 'button', text: '导入' });
		submit.addClass('mod-cta');

		cancel.addEventListener('click', () => this.close());
		submit.addEventListener('click', () => {
			void this.submit(input.value);
		});
		input.addEventListener('keydown', (event: KeyboardEvent) => {
			if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
				event.preventDefault();
				void this.submit(input.value);
			}
		});
		input.focus();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async submit(content: string): Promise<void> {
		try {
			const path = await this.onSubmit(content);
			new Notice(`已导入 ${path}`);
			this.close();
		} catch (error) {
			showActionError(error);
		}
	}
}
