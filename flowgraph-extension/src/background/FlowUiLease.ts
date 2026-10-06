export class FlowUiMutex {
  private tail: Promise<void> = Promise.resolve();

  async acquire(check: () => void = () => {}): Promise<() => void> {
    let release!: () => void;
    const next = new Promise<void>((resolve) => { release = resolve; });
    const previous = this.tail;
    this.tail = previous.then(() => next, () => next);

    try {
      check();
      while (true) {
        let done = false;
        await Promise.race([
          previous.then(() => { done = true; }),
          new Promise((resolve) => setTimeout(resolve, 150)),
        ]);
        check();
        if (done) break;
      }
    } catch (error) {
      release();
      throw error;
    }

    let released = false;
    return () => {
      if (!released) {
        released = true;
        release();
      }
    };
  }
}

/** Owns the composer only while interacting with it, never while rendering. */
export class FlowUiLease {
  private release?: () => void;
  constructor(private readonly mutex: FlowUiMutex, private readonly check: () => void) {}
  async acquire(): Promise<void> {
    if (!this.release) this.release = await this.mutex.acquire(this.check);
    this.check();
  }
  yield(): void {
    this.release?.();
    this.release = undefined;
  }
}
