function assertObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function assertFiniteNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number`);
  }
}

function assertCapacity(value) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new TypeError(
      "capacity must be an integer greater than or equal to 1",
    );
  }
}

function assertMaxAge(value) {
  if (
    value !== Infinity &&
    (typeof value !== "number" || !Number.isFinite(value) || value < 0)
  ) {
    throw new TypeError(
      "maxAge must be Infinity or a finite number greater than or equal to 0",
    );
  }
}

function emptySample() {
  return {
    status: "empty",
    renderTime: null,
    from: null,
    to: null,
    factor: null,
    overshoot: null,
    shortfall: null,
  };
}

export class SnapshotBuffer {
  #snapshots = [];
  #delay = 0;
  #capacity = 32;
  #maxAge = Infinity;

  constructor(options = {}) {
    assertObject(options, "options");
    this.delay = options.delay === undefined ? 0 : options.delay;
    this.capacity = options.capacity === undefined ? 32 : options.capacity;
    this.maxAge = options.maxAge === undefined ? Infinity : options.maxAge;
  }

  get delay() {
    return this.#delay;
  }

  set delay(value) {
    assertFiniteNumber(value, "delay");
    this.#delay = value;
  }

  get capacity() {
    return this.#capacity;
  }

  set capacity(value) {
    assertCapacity(value);
    this.#capacity = value;
    this.#trim();
  }

  get maxAge() {
    return this.#maxAge;
  }

  set maxAge(value) {
    assertMaxAge(value);
    this.#maxAge = value;
    this.#trim();
  }

  get size() {
    return this.#snapshots.length;
  }

  get snapshots() {
    return this.#snapshots.slice();
  }

  get oldest() {
    return this.#snapshots[0];
  }

  get newest() {
    return this.#snapshots[this.#snapshots.length - 1];
  }

  push(time, state) {
    assertFiniteNumber(time, "time");
    const snaps = this.#snapshots;
    if (snaps.length > 0 && !(time > snaps[snaps.length - 1].time)) {
      return false;
    }
    snaps.push(Object.freeze({ time, state }));
    this.#trim();
    return true;
  }

  sample() {
    const snaps = this.#snapshots;
    if (snaps.length === 0) {
      return emptySample();
    }

    const newest = snaps[snaps.length - 1];
    const oldest = snaps[0];
    const renderTime = newest.time - this.#delay;

    if (renderTime > newest.time) {
      return {
        status: "extrapolate",
        renderTime,
        from: snaps.length > 1 ? snaps[snaps.length - 2] : null,
        to: newest,
        factor: null,
        overshoot: renderTime - newest.time,
        shortfall: null,
      };
    }

    if (renderTime < oldest.time) {
      return {
        status: "before",
        renderTime,
        from: oldest,
        to: oldest,
        factor: null,
        overshoot: null,
        shortfall: oldest.time - renderTime,
      };
    }

    let fromIndex = 0;
    for (let index = 0; index < snaps.length; index += 1) {
      if (snaps[index].time <= renderTime) {
        fromIndex = index;
      } else {
        break;
      }
    }

    const from = snaps[fromIndex];
    const to =
      fromIndex + 1 < snaps.length ? snaps[fromIndex + 1] : snaps[fromIndex];
    let factor = 0;
    if (to.time !== from.time) {
      factor = (renderTime - from.time) / (to.time - from.time);
      if (factor < 0) {
        factor = 0;
      } else if (factor > 1) {
        factor = 1;
      }
    }

    return {
      status: "bracket",
      renderTime,
      from,
      to,
      factor,
      overshoot: null,
      shortfall: null,
    };
  }

  clear() {
    this.#snapshots.length = 0;
  }

  #trim() {
    const snaps = this.#snapshots;
    if (snaps.length === 0) {
      return;
    }

    const newestTime = snaps[snaps.length - 1].time;
    if (this.#maxAge !== Infinity) {
      const cutoff = newestTime - this.#maxAge;
      let dropCount = 0;
      while (dropCount < snaps.length && snaps[dropCount].time < cutoff) {
        dropCount += 1;
      }
      if (dropCount > 0) {
        snaps.splice(0, dropCount);
      }
    }

    if (snaps.length > this.#capacity) {
      snaps.splice(0, snaps.length - this.#capacity);
    }
  }
}

export function lerp(from, to, factor) {
  assertFiniteNumber(from, "from");
  assertFiniteNumber(to, "to");
  assertFiniteNumber(factor, "factor");
  return from + (to - from) * factor;
}
