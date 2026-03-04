// CLOSED → normal, requests pass through
// OPEN   → tripped, requests blocked until cooldown elapses
// HALF   → cooldown elapsed, next request is a probe; success→CLOSED, fail→OPEN

export class CircuitBreaker {
  #state = 'CLOSED';
  #failures = 0;
  #lastFailTime = 0;

  constructor({
    name,
    threshold    = 3,       // consecutive failures before tripping
    cooldown     = 30_000,  // ms to stay OPEN before probing
    onStateChange,
  } = {}) {
    this.name = name;
    this.threshold = threshold;
    this.cooldown = cooldown;
    this.onStateChange = onStateChange ?? (() => {});
  }

  get state() { return this.#state; }

  async call(fn) {
    if (this.#state === 'OPEN') {
      if (Date.now() - this.#lastFailTime < this.cooldown) {
        throw new Error(`[CircuitBreaker:${this.name}] OPEN — skipping request`);
      }
      this.#setState('HALF');
    }

    try {
      const result = await fn();
      this.#onSuccess();
      return result;
    } catch (err) {
      this.#onFailure();
      throw err;
    }
  }

  #onSuccess() {
    this.#failures = 0;
    if (this.#state !== 'CLOSED') this.#setState('CLOSED');
  }

  #onFailure() {
    this.#failures++;
    this.#lastFailTime = Date.now();
    if (this.#state === 'HALF' || this.#failures >= this.threshold) {
      this.#setState('OPEN');
    }
  }

  #setState(next) {
    this.#state = next;
    this.onStateChange(this.name, next);
  }
}
