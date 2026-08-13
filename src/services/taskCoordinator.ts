import type { RequestContext } from '../application/requestContext.ts';
import { createRequestContext } from '../application/requestContext.ts';

export type TaskStatus = 'idle' | 'running' | 'paused' | 'cancelled';

export interface ScheduledTask {
	id: string;
	name: string;
	description: string;
	intervalMs: number;
	status: TaskStatus;
	lastRun: string | null;
	nextRun: string | null;
	runCount: number;
	handler: (context: RequestContext) => Promise<void>;
}

/** Coordinates periodic background tasks without blocking the UI. */
export class TaskCoordinator {
	private tasks = new Map<string, ScheduledTask>();
	private timers = new Map<string, ReturnType<typeof setInterval>>();
	private isPaused = false;

	register(task: ScheduledTask): void {
		this.tasks.set(task.id, task);
	}

	unregister(id: string): void {
		this.stop(id);
		this.tasks.delete(id);
	}

	start(id: string): void {
		const task = this.tasks.get(id);
		if (!task || task.status === 'running') return;
		task.status = 'running';
		this.schedule(task);
	}

	stop(id: string): void {
		const timer = this.timers.get(id);
		if (timer) { clearInterval(timer); this.timers.delete(id); }
		const task = this.tasks.get(id);
		if (task) task.status = 'idle';
	}

	pauseAll(): void {
		this.isPaused = true;
		this.timers.forEach((timer) => clearInterval(timer));
		this.timers.clear();
		this.tasks.forEach((t) => { if (t.status === 'running') t.status = 'paused'; });
	}

	resumeAll(): void {
		this.isPaused = false;
		this.tasks.forEach((task) => {
			if (task.status === 'paused') { task.status = 'running'; this.schedule(task); }
		});
	}

	getTasks(): ScheduledTask[] {
		return [...this.tasks.values()];
	}

	getStatus(id: string): TaskStatus | null {
		return this.tasks.get(id)?.status ?? null;
	}

	private schedule(task: ScheduledTask): void {
		if (this.isPaused) return;
		/* Run immediately first, then on interval */
		this.runTask(task);
		const timer = setInterval(() => this.runTask(task), task.intervalMs);
		this.timers.set(task.id, timer);
	}

	private async runTask(task: ScheduledTask): Promise<void> {
		task.lastRun = new Date().toISOString();
		task.nextRun = new Date(Date.now() + task.intervalMs).toISOString();
		task.runCount++;
		try {
			await task.handler(createRequestContext('background-task'));
		} catch {
			/* Task error handled by the handler */
		}
	}
}