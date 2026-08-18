/**
 * A minimal FIFO serial queue for mutually-exclusive asynchronous operations.
 *
 * Used by JSONL persistence stores to guarantee that read-modify-write
 * cycles never interleave: each operation is appended to the previous one,
 * and the tail swallows rejections so one failed operation cannot block the
 * queue forever.
 */
export class SerialQueue {
	private tail: Promise<unknown> = Promise.resolve();

	/** Runs operation after every previously enqueued operation settles. */
	run<T>(operation: () => Promise<T>): Promise<T> {
		const next = this.tail.then(operation, operation);
		// Keep the queue alive even when an operation throws.
		this.tail = next.catch(() => undefined);
		return next;
	}
}
