import { App, Modal, Notice, TFile } from 'obsidian';
import type { RequestContext } from '../application/requestContext';
import type { VisionService } from '../services/visionService';
import { showActionError } from '../services/agentActionService';

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif'];

/** Modal to pick an image in the vault and run an image-understanding task. */
export class ImageUnderstandModal extends Modal {
	constructor(
		app: App,
		private readonly vision: VisionService,
		private readonly context: RequestContext,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle('图片理解');
		const images = this.app.vault.getFiles()
			.filter((file) => IMAGE_EXTENSIONS.includes(file.extension.toLocaleLowerCase()))
			.map((file) => file.path)
			.sort();

		const search = this.contentEl.createEl('input', {
			attr: { type: 'search', placeholder: '搜索图片…', 'aria-label': '搜索图片' },
		});

		const task = this.contentEl.createEl('select', { attr: { 'aria-label': '选择任务' } });
		task.createEl('option', { value: 'summarize', text: '总结图片内容' });
		task.createEl('option', { value: 'ocr', text: '提取文字（OCR）' });
		task.createEl('option', { value: 'diagram', text: '解读图表/示意图' });

		const list = this.contentEl.createDiv({ cls: 'agent-dashboard-vision-list' });

		const render = (filter: string): void => {
			list.empty();
			const query = filter.trim().toLocaleLowerCase();
			const visible = query
				? images.filter((path) => path.toLocaleLowerCase().includes(query))
				: images;
			if (visible.length === 0) {
				list.createDiv({ cls: 'agent-dashboard-empty-state', text: '没有找到图片。' });
				return;
			}
			visible.slice(0, 100).forEach((path) => {
				const row = list.createEl('button', {
					cls: 'agent-dashboard-vision-item',
					attr: { type: 'button' },
				});
				row.createSpan({ text: path });
				row.addEventListener('click', () => {
					void this.generate(path, task.value as 'summarize' | 'ocr' | 'diagram');
				});
			});
		};

		search.addEventListener('input', () => render(search.value));
		render('');

		const actions = this.contentEl.createDiv({ cls: 'agent-dashboard-modal-actions' });
		actions.createEl('button', { type: 'button', text: '取消' }).addEventListener('click', () => this.close());
	}

	private async generate(path: string, task: 'summarize' | 'ocr' | 'diagram'): Promise<void> {
		const notice = new Notice(`正在理解 ${path} …`);
		try {
			const content = await this.vision.understandImage(path, task, this.context);
			const reportPath = await this.vision.writeImageReport(path, content);
			notice.hide();
			new Notice(`图片理解完成：${reportPath}`);
			const file = this.app.vault.getAbstractFileByPath(reportPath);
			if (file instanceof TFile) {
				await this.app.workspace.getLeaf('tab').openFile(file);
			}
			this.close();
		} catch (error) {
			notice.hide();
			showActionError(error);
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
