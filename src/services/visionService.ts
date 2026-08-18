import type { App } from 'obsidian';
import { createRequestContext, type RequestContext } from '../application/requestContext';
import type { OpenAiModel } from '../adapters/openAiModel';
import { WORKBENCH_DIRS } from '../data/dashboardTypes';
import type { WorkbenchWriteService } from './workbenchWriteService';
import {
	byteArrayToBase64,
	mimeFromPath,
	VISION_MAX_BASE64_LENGTH,
	VISION_TASK_PROMPTS,
	type VisionTask,
} from '../application/visionCompletions';

/**
 * Reads an image from the vault, sends it to the configured vision model and
 * writes the result as a Markdown report under Reports/.
 */
export class VisionService {
	constructor(
		private readonly app: App,
		private readonly model: OpenAiModel,
		private readonly workbenchWrite: WorkbenchWriteService,
	) {}

	async understandImage(
		path: string,
		task: VisionTask,
		context: RequestContext,
	): Promise<string> {
		const mime = mimeFromPath(path);
		if (!mime) {
			throw new Error('不支持的图片格式，请选择 png/jpg/jpeg/webp/gif');
		}
		const buffer = await this.app.vault.adapter.readBinary(path);
		const dataUrl = 'data:' + mime + ';base64,' + byteArrayToBase64(new Uint8Array(buffer));
		if (dataUrl.length > VISION_MAX_BASE64_LENGTH) {
			throw new Error('图片过大，请选择较小的图片');
		}
		const prompt = VISION_TASK_PROMPTS[task];
		return this.model.generateVision(prompt, dataUrl, context);
	}

	async writeImageReport(path: string, content: string, context: RequestContext = createRequestContext('user')): Promise<string> {
		const now = new Date();
		const stamp = [
			now.getFullYear(),
			String(now.getMonth() + 1).padStart(2, '0'),
			String(now.getDate()).padStart(2, '0'),
			'-',
			String(now.getHours()).padStart(2, '0'),
			String(now.getMinutes()).padStart(2, '0'),
			String(now.getSeconds()).padStart(2, '0'),
		].join('');
		const fileName = '图片理解-' + stamp + '.md';
		const reportPath = `${WORKBENCH_DIRS.reports}/${fileName}`;
		const result = await this.workbenchWrite.writeGenerated({
			path: reportPath,
			content: `# 图片理解\n\n- 来源：${path}\n\n---\n\n${content}\n`,
			kind: 'vision',
			context,
		});
		if (result.status === 'failed') {
			throw new Error(result.error_code ?? '图片报告写入失败');
		}
		return result.path;
	}
}
