export interface GraphNodePosition {
	x: number;
	y: number;
	vx: number;
	vy: number;
	r: number;
}

export interface GraphNodeState {
	id: string;
	pos: GraphNodePosition;
}

export interface GraphEdge {
	source: string;
	target: string;
}

const SPRING = 120;
const CELL_SIZE = 120;

/** Applies one force-directed layout step using a spatial grid for repulsion. */
export function applyForceStep(
	nodes: GraphNodeState[],
	edges: GraphEdge[],
	area: number,
	width: number,
	height: number,
	dragId: string | null,
): void {
	const positions = new Map<string, GraphNodePosition>();
	for (const node of nodes) positions.set(node.id, node.pos);

	/* 弹簧力（沿边） */
	for (const edge of edges) {
		const a = positions.get(edge.source);
		const b = positions.get(edge.target);
		if (!a || !b || a === b) continue;
		const dx = b.x - a.x;
		const dy = b.y - a.y;
		const dist = Math.max(1, Math.hypot(dx, dy));
		const force = (dist - SPRING) * 0.02;
		const fx = (dx / dist) * force;
		const fy = (dy / dist) * force;
		if (dragId !== edge.source) { a.vx += fx; a.vy += fy; }
		if (dragId !== edge.target) { b.vx -= fx; b.vy -= fy; }
	}

	/* 斥力（空间网格：只比较相邻 3×3 桶） */
	const buckets = new Map<string, GraphNodeState[]>();
	for (const node of nodes) {
		const key = cellKey(node.pos.x, node.pos.y);
		const bucket = buckets.get(key);
		if (bucket) bucket.push(node); else buckets.set(key, [node]);
	}
	for (const node of nodes) {
		const cx = Math.floor(node.pos.x / CELL_SIZE);
		const cy = Math.floor(node.pos.y / CELL_SIZE);
		for (let gx = cx - 1; gx <= cx + 1; gx += 1) {
			for (let gy = cy - 1; gy <= cy + 1; gy += 1) {
				const bucket = buckets.get(gx + ':' + gy);
				if (!bucket) continue;
				for (const other of bucket) {
					if (node.id >= other.id) continue;
					const a = node.pos;
					const b = other.pos;
					const dx = b.x - a.x;
					const dy = b.y - a.y;
					const dist = Math.max(1, Math.hypot(dx, dy));
					const force = Math.min(600, (area * area) / (dist * dist)) * 0.5;
					const fx = (dx / dist) * force;
					const fy = (dy / dist) * force;
					if (dragId !== node.id) { a.vx -= fx; a.vy -= fy; }
					if (dragId !== other.id) { b.vx += fx; b.vy += fy; }
				}
			}
		}
	}

	for (const node of nodes) {
		const pos = node.pos;
		pos.vx *= 0.85;
		pos.vy *= 0.85;
		pos.vx += (width / 2 - pos.x) * 0.001;
		pos.vy += (height / 2 - pos.y) * 0.001;
		if (dragId !== node.id) {
			pos.x += pos.vx;
			pos.y += pos.vy;
		}
		pos.x = Math.max(10, Math.min(width - 10, pos.x));
		pos.y = Math.max(10, Math.min(height - 10, pos.y));
	}
}

function cellKey(x: number, y: number): string {
	return Math.floor(x / CELL_SIZE) + ':' + Math.floor(y / CELL_SIZE);
}
