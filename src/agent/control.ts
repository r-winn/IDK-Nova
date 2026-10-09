/** Cooperative suspension between actions; in-flight OS actions finish first. */
export class AgentControl {
  paused = false;
  private resumeWaiters = new Set<() => void>();
  pause() { this.paused = true; }
  resume() {
    this.paused = false;
    for (const resolve of this.resumeWaiters) resolve();
    this.resumeWaiters.clear();
  }
  async checkpoint(signal: AbortSignal) {
    if (signal.aborted) throw new DOMException('Task stopped', 'AbortError');
    if (!this.paused) return;
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => { signal.removeEventListener('abort', abort); this.resumeWaiters.delete(resume); };
      const resume = () => { cleanup(); resolve(); };
      const abort = () => { cleanup(); reject(new DOMException('Task stopped', 'AbortError')); };
      this.resumeWaiters.add(resume);
      signal.addEventListener('abort', abort, { once: true });
    });
  }
}
