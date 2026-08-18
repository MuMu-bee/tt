import { applyForceStep } from './graphForceLayout';

export interface GraphCanvasNode {
	id: string;
	title: string;
	type: string;
	degree: number;
}

export interface GraphCanvasEdge {
	source: string;
	target: string;
}

export interface GraphCanvasDeps {
	registerDomEvent: (el: HTMLElement | Window, type: string, callback: (event: Event) => void) => void;
	openPath: (path: string) => Promise<void>;
	setFeedback: (message: string) => void;
	onRefresh: (refresh: () => void) => void;
}

export function renderGraphCanvas(
	canvas: HTMLCanvasElement,
	nodes: GraphCanvasNode[],
	edges: GraphCanvasEdge[],
	searchInput: HTMLInputElement,
	deps: GraphCanvasDeps,
): void {
	const container = canvas.parentElement;
	if (!container) return;
	const ctx = canvas.getContext('2d');
	if (!ctx) return;

	const typeColors: Record<string, string> = {
		wiki: '#8b5cf6',
		raw: '#10b981',
		inbox: '#f59e0b',
		note: '#3b82f6',
	};

	const positions = new Map<string, { x: number; y: number; vx: number; vy: number; r: number }>();
	const width = (): number => container.clientWidth;
	const height = (): number => container.clientHeight;
	let initialized = false;
	let area = 80;

	const initializePositions = (): void => {
		if (positions.size > 0) return;
		const w = Math.max(1, width());
		const h = Math.max(1, height());
		area = nodes.length > 0 ? Math.sqrt((w * h) / nodes.length) : 80;
		nodes.forEach((node, index) => {
			const angle = (index / Math.max(1, nodes.length)) * Math.PI * 2;
			const radius = Math.min(w, h) * 0.35 * (0.6 + 0.4 * Math.random());
			positions.set(node.id, {
				x: w / 2 + Math.cos(angle) * radius,
				y: h / 2 + Math.sin(angle) * radius,
				vx: 0,
				vy: 0,
				r: Math.max(5, Math.min(16, 6 + Math.sqrt(node.degree) * 2)),
			});
		});
	};

	const DPR = window.devicePixelRatio || 1;
	const resize = (): void => {
		canvas.width = Math.max(1, Math.floor(Math.max(1, width()) * DPR));
		canvas.height = Math.max(1, Math.floor(Math.max(1, height()) * DPR));
		ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
	};
	resize();

	let dragId: string | null = null;
	let hoverId: string | null = null;
	let animationFrame = 0;
	let running = true;

	const nodeAt = (mx: number, my: number): string | null => {
		let best: string | null = null;
		let bestDist = 30;
		positions.forEach((pos, id) => {
			const d = Math.hypot(mx - pos.x, my - pos.y);
			if (d < bestDist) { bestDist = d; best = id; }
		});
		return best;
	};

	const step = (): void => {
		const valid: Array<{ id: string; pos: { x: number; y: number; vx: number; vy: number; r: number } }> = [];
		positions.forEach((pos, id) => valid.push({ id, pos }));
		applyForceStep(valid, edges, area, width(), height(), dragId);
	};

	const draw = (): void => {
		ctx.clearRect(0, 0, width(), height());
		ctx.lineWidth = 1;
		ctx.strokeStyle = 'rgba(128,128,128,0.25)';
		for (const edge of edges) {
			const a = positions.get(edge.source);
			const b = positions.get(edge.target);
			if (!a || !b) continue;
			ctx.beginPath();
			ctx.moveTo(a.x, a.y);
			ctx.lineTo(b.x, b.y);
			ctx.stroke();
		}
		for (const node of nodes) {
			const pos = positions.get(node.id);
			if (!pos) continue;
			const active = hoverId === node.id || dragId === node.id;
			const color = typeColors[node.type] ?? '#3b82f6';
			ctx.beginPath();
			ctx.arc(pos.x, pos.y, pos.r, 0, Math.PI * 2);
			ctx.fillStyle = active ? color : color + 'cc';
			ctx.fill();
			if (active) {
				ctx.strokeStyle = '#ffffff';
				ctx.lineWidth = 2;
				ctx.stroke();
			}
		}
		if (hoverId) {
			const node = nodes.find((n) => n.id === hoverId);
			const pos = positions.get(hoverId);
			if (node && pos) {
				ctx.font = '12px sans-serif';
				ctx.fillStyle = 'rgba(30,30,30,0.9)';
				ctx.fillText(node.title, pos.x + pos.r + 4, pos.y + 4);
			}
		}
	};

	let iterations = 0;
	const loop = (): void => {
		if (!running || !canvas.isConnected) {
			running = false;
			if (animationFrame) window.cancelAnimationFrame(animationFrame);
			return;
		}
		if (!initialized) {
			if (width() === 0 || height() === 0) {
				animationFrame = window.requestAnimationFrame(loop);
				return;
			}
			resize();
			initializePositions();
			initialized = true;
			iterations = 0;
		}
		if (iterations < 200 || dragId !== null) {
			step();
			iterations += 1;
			draw();
			animationFrame = window.requestAnimationFrame(loop);
		} else {
			draw();
		}
	};
	loop();

	deps.onRefresh((): void => {
		resize();
		if (initialized) {
			positions.clear();
			initializePositions();
			iterations = 0;
			loop();
		}
	});

	const toLocal = (event: PointerEvent): { x: number; y: number } => {
		const rect = canvas.getBoundingClientRect();
		return { x: event.clientX - rect.left, y: event.clientY - rect.top };
	};

	deps.registerDomEvent(canvas, 'pointerdown', (event: Event) => {
		const { x, y } = toLocal(event as PointerEvent);
		dragId = nodeAt(x, y);
		if (dragId) {
			canvas.setPointerCapture((event as PointerEvent).pointerId);
			iterations = 0;
			loop();
		}
	});
	deps.registerDomEvent(canvas, 'pointermove', (event: Event) => {
		const { x, y } = toLocal(event as PointerEvent);
		if (dragId) {
			const pos = positions.get(dragId);
			if (pos) { pos.x = x; pos.y = y; }
		} else {
			hoverId = nodeAt(x, y);
			canvas.style.cursor = hoverId ? 'pointer' : 'default';
			draw();
		}
	});
	deps.registerDomEvent(canvas, 'pointerup', () => {
		if (!dragId) return;
		dragId = null;
		iterations = 0;
		loop();
	});
	deps.registerDomEvent(canvas, 'click', (event: Event) => {
		const { x, y } = toLocal(event as PointerEvent);
		const id = nodeAt(x, y);
		if (!id) return;
		void deps.openPath(id);
	});

	deps.registerDomEvent(searchInput, 'input', () => {
		const query = searchInput.value.trim().toLocaleLowerCase();
		if (!query) { hoverId = null; draw(); return; }
		const found = nodes.find((node) =>
			node.title.toLocaleLowerCase().includes(query) || node.id.toLocaleLowerCase().includes(query),
		);
		hoverId = found?.id ?? null;
		draw();
	});

	deps.registerDomEvent(window, 'resize', resize);
}
