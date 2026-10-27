import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { SnapshotBuffer, lerp } from "../src/index.js";

function states(buffer) {
  return buffer.snapshots.map((snapshot) => snapshot.state);
}

function times(buffer) {
  return buffer.snapshots.map((snapshot) => snapshot.time);
}

describe("constructor", () => {
  it("uses delay 0, capacity 32, and infinite maxAge by default", () => {
    const buffer = new SnapshotBuffer();
    assert.equal(buffer.delay, 0);
    assert.equal(buffer.capacity, 32);
    assert.equal(buffer.maxAge, Infinity);
    assert.equal(buffer.size, 0);
    assert.equal(buffer.oldest, undefined);
    assert.equal(buffer.newest, undefined);
    assert.deepEqual(buffer.snapshots, []);
  });

  it("accepts an explicit configuration", () => {
    const buffer = new SnapshotBuffer({
      delay: 25,
      capacity: 4,
      maxAge: 80,
    });
    assert.equal(buffer.delay, 25);
    assert.equal(buffer.capacity, 4);
    assert.equal(buffer.maxAge, 80);
  });

  it("treats undefined option fields as defaults", () => {
    const buffer = new SnapshotBuffer({
      delay: undefined,
      capacity: undefined,
      maxAge: undefined,
    });
    assert.equal(buffer.delay, 0);
    assert.equal(buffer.capacity, 32);
    assert.equal(buffer.maxAge, Infinity);
  });

  it("rejects a non-object options value", () => {
    for (const options of [null, 1, "buffer", true]) {
      assert.throws(() => new SnapshotBuffer(options), {
        name: "TypeError",
        message: "options must be an object",
      });
    }
  });

  it("rejects an array options value", () => {
    assert.throws(() => new SnapshotBuffer([]), {
      name: "TypeError",
      message: "options must be an object",
    });
  });

  it("rejects a non-finite delay", () => {
    for (const delay of [Number.NaN, Infinity, -Infinity, "10", null, true]) {
      assert.throws(() => new SnapshotBuffer({ delay }), {
        name: "TypeError",
        message: "delay must be a finite number",
      });
    }
  });

  it("rejects a capacity that is not an integer >= 1", () => {
    for (const capacity of [0, -1, 1.5, Infinity, Number.NaN, "8", null]) {
      assert.throws(() => new SnapshotBuffer({ capacity }), {
        name: "TypeError",
        message: "capacity must be an integer greater than or equal to 1",
      });
    }
  });

  it("rejects a negative or non-finite maxAge", () => {
    for (const maxAge of [-1, Number.NaN, -Infinity, "5", null, true]) {
      assert.throws(() => new SnapshotBuffer({ maxAge }), {
        name: "TypeError",
        message:
          "maxAge must be Infinity or a finite number greater than or equal to 0",
      });
    }
  });

  it("accepts maxAge of 0 and Infinity", () => {
    assert.equal(new SnapshotBuffer({ maxAge: 0 }).maxAge, 0);
    assert.equal(new SnapshotBuffer({ maxAge: Infinity }).maxAge, Infinity);
  });
});

describe("push", () => {
  it("stores any state value by reference", () => {
    const buffer = new SnapshotBuffer();
    const objectState = { id: 1 };
    const values = [
      objectState,
      null,
      undefined,
      0,
      false,
      "",
      [1, 2],
      Symbol("mark"),
      10n,
    ];

    values.forEach((state, index) => {
      assert.equal(buffer.push(index, state), true);
    });

    assert.deepEqual(
      buffer.snapshots.map((snapshot) => snapshot.state),
      values,
    );
    assert.equal(buffer.snapshots[0].state, objectState);
    objectState.id = 2;
    assert.equal(buffer.snapshots[0].state.id, 2);
  });

  it("freezes the snapshot record and not the state object", () => {
    const buffer = new SnapshotBuffer();
    const state = { x: 1 };
    buffer.push(5, state);
    const snapshot = buffer.newest;
    assert.equal(Object.isFrozen(snapshot), true);
    assert.throws(() => {
      snapshot.time = 9;
    }, TypeError);
    state.x = 4;
    assert.equal(buffer.newest.state.x, 4);
  });

  it("keeps snapshots in increasing timestamp order", () => {
    const buffer = new SnapshotBuffer({ capacity: 10 });
    for (const time of [-5, -4, 0, 0.5, 2]) {
      assert.equal(buffer.push(time, time), true);
    }
    assert.deepEqual(times(buffer), [-5, -4, 0, 0.5, 2]);
  });

  it("ignores a duplicate of the newest timestamp and keeps the original state", () => {
    const buffer = new SnapshotBuffer();
    assert.equal(buffer.push(10, "first"), true);
    assert.equal(buffer.push(10, "second"), false);
    assert.equal(buffer.size, 1);
    assert.equal(buffer.newest.state, "first");
  });

  it("treats 0 and -0 as the same timestamp", () => {
    const buffer = new SnapshotBuffer();
    assert.equal(buffer.push(0, "zero"), true);
    assert.equal(buffer.push(-0, "negative-zero"), false);
    assert.equal(buffer.newest.state, "zero");

    const other = new SnapshotBuffer();
    assert.equal(other.push(-0, "negative-zero"), true);
    assert.equal(other.push(0, "zero"), false);
    assert.equal(other.newest.state, "negative-zero");
  });

  it("ignores an older timestamp", () => {
    const buffer = new SnapshotBuffer();
    assert.equal(buffer.push(10, "a"), true);
    assert.equal(buffer.push(12, "b"), true);
    assert.equal(buffer.push(11, "late"), false);
    assert.equal(buffer.push(9, "older"), false);
    assert.deepEqual(states(buffer), ["a", "b"]);
  });

  it("does not insert a late timestamp into a gap left by trimming", () => {
    const buffer = new SnapshotBuffer({ capacity: 2 });
    assert.equal(buffer.push(1, "a"), true);
    assert.equal(buffer.push(2, "b"), true);
    assert.equal(buffer.push(3, "c"), true);
    assert.deepEqual(states(buffer), ["b", "c"]);
    assert.equal(buffer.push(1, "replay"), false);
    assert.deepEqual(states(buffer), ["b", "c"]);
  });

  it("leaves the buffer unchanged when a push is ignored", () => {
    const buffer = new SnapshotBuffer({ maxAge: 10, capacity: 8 });
    buffer.push(0, "old");
    buffer.push(10, "new");
    const before = buffer.sample();
    assert.equal(buffer.push(5, "late"), false);
    assert.equal(buffer.push(10, "dup"), false);
    assert.deepEqual(buffer.sample(), before);
    assert.deepEqual(times(buffer), [0, 10]);
  });

  it("rejects a non-finite timestamp", () => {
    const buffer = new SnapshotBuffer();
    buffer.push(1, "kept");
    for (const time of [
      Number.NaN,
      Infinity,
      -Infinity,
      "1",
      null,
      undefined,
    ]) {
      assert.throws(() => buffer.push(time, "nope"), {
        name: "TypeError",
        message: "time must be a finite number",
      });
    }
    assert.deepEqual(states(buffer), ["kept"]);
  });

  it("accepts the first snapshot after clear at any finite time", () => {
    const buffer = new SnapshotBuffer();
    buffer.push(50, "a");
    buffer.clear();
    assert.equal(buffer.push(10, "b"), true);
    assert.equal(buffer.newest.state, "b");
  });
});

describe("trimming", () => {
  it("drops the oldest snapshots past capacity", () => {
    const buffer = new SnapshotBuffer({ capacity: 3 });
    for (let time = 0; time < 5; time += 1) {
      buffer.push(time, time);
    }
    assert.deepEqual(times(buffer), [2, 3, 4]);
    assert.equal(buffer.oldest.state, 2);
    assert.equal(buffer.newest.state, 4);
  });

  it("uses the default capacity of 32", () => {
    const buffer = new SnapshotBuffer();
    for (let time = 0; time < 40; time += 1) {
      buffer.push(time, time);
    }
    assert.equal(buffer.size, 32);
    assert.deepEqual(
      times(buffer),
      Array.from({ length: 32 }, (_, i) => i + 8),
    );
  });

  it("drops snapshots strictly older than maxAge and keeps an exact maxAge", () => {
    const buffer = new SnapshotBuffer({ maxAge: 15, capacity: 10 });
    for (const time of [0, 10, 25]) {
      buffer.push(time, time);
    }
    assert.deepEqual(times(buffer), [10, 25]);
  });

  it("measures age from the newest stored timestamp", () => {
    const buffer = new SnapshotBuffer({ maxAge: 5, capacity: 10 });
    buffer.push(0, "a");
    buffer.push(10, "b");
    buffer.push(100, "c");
    assert.deepEqual(states(buffer), ["c"]);
  });

  it("keeps only the newest snapshot when maxAge is 0", () => {
    const buffer = new SnapshotBuffer({ maxAge: 0, capacity: 10 });
    buffer.push(1, "a");
    buffer.push(2, "b");
    buffer.push(2.5, "c");
    assert.deepEqual(states(buffer), ["c"]);
  });

  it("applies age before capacity", () => {
    const buffer = new SnapshotBuffer({ capacity: 2, maxAge: 15 });
    for (const time of [0, 10, 20, 30, 40]) {
      buffer.push(time, time);
    }
    assert.deepEqual(times(buffer), [30, 40]);
  });

  it("drops by capacity when every snapshot is inside maxAge", () => {
    const buffer = new SnapshotBuffer({ capacity: 2, maxAge: 1000 });
    for (const time of [0, 10, 20, 30]) {
      buffer.push(time, time);
    }
    assert.deepEqual(times(buffer), [20, 30]);
  });

  it("trims immediately when capacity is lowered", () => {
    const buffer = new SnapshotBuffer({ capacity: 4 });
    for (const time of [1, 2, 3, 4]) {
      buffer.push(time, time);
    }
    buffer.capacity = 2;
    assert.deepEqual(times(buffer), [3, 4]);
  });

  it("trims immediately when maxAge is lowered", () => {
    const buffer = new SnapshotBuffer({ maxAge: 100, capacity: 10 });
    for (const time of [0, 10, 20]) {
      buffer.push(time, time);
    }
    buffer.maxAge = 10;
    assert.deepEqual(times(buffer), [10, 20]);
    buffer.maxAge = 0;
    assert.deepEqual(times(buffer), [20]);
  });

  it("does not restore removed snapshots when the limits grow", () => {
    const buffer = new SnapshotBuffer({ capacity: 1, maxAge: 0 });
    buffer.push(1, "a");
    buffer.push(2, "b");
    buffer.capacity = 10;
    buffer.maxAge = 100;
    assert.deepEqual(states(buffer), ["b"]);
  });

  it("rejects an invalid capacity or maxAge assignment without changing the buffer", () => {
    const buffer = new SnapshotBuffer({ capacity: 3, maxAge: 50 });
    buffer.push(1, "a");
    buffer.push(2, "b");
    assert.throws(() => {
      buffer.capacity = 0;
    }, TypeError);
    assert.throws(() => {
      buffer.maxAge = -5;
    }, TypeError);
    assert.equal(buffer.capacity, 3);
    assert.equal(buffer.maxAge, 50);
    assert.deepEqual(states(buffer), ["a", "b"]);
  });

  it("rejects an invalid delay assignment without changing the previous delay", () => {
    const buffer = new SnapshotBuffer({ delay: 12 });
    assert.throws(() => {
      buffer.delay = Infinity;
    }, TypeError);
    assert.equal(buffer.delay, 12);
  });
});

describe("sample", () => {
  it("reports an empty buffer", () => {
    const buffer = new SnapshotBuffer({ delay: 40 });
    assert.deepEqual(buffer.sample(), {
      status: "empty",
      renderTime: null,
      from: null,
      to: null,
      factor: null,
      overshoot: null,
      shortfall: null,
    });
  });

  it("reports empty after clear", () => {
    const buffer = new SnapshotBuffer();
    buffer.push(1, "a");
    buffer.clear();
    assert.equal(buffer.sample().status, "empty");
    assert.equal(buffer.size, 0);
  });

  it("brackets a render time between two snapshots", () => {
    const buffer = new SnapshotBuffer({ delay: 15, capacity: 8 });
    buffer.push(0, { x: 0 });
    buffer.push(10, { x: 10 });
    buffer.push(20, { x: 30 });

    const sample = buffer.sample();
    assert.equal(sample.status, "bracket");
    assert.equal(sample.renderTime, 5);
    assert.equal(sample.from.time, 0);
    assert.equal(sample.to.time, 10);
    assert.equal(sample.factor, 0.5);
    assert.equal(sample.overshoot, null);
    assert.equal(sample.shortfall, null);
    assert.equal(
      lerp(sample.from.state.x, sample.to.state.x, sample.factor),
      5,
    );
  });

  it("uses the later pair when the render time falls there", () => {
    const buffer = new SnapshotBuffer({ delay: 5 });
    buffer.push(0, "a");
    buffer.push(10, "b");
    buffer.push(20, "c");
    const sample = buffer.sample();
    assert.equal(sample.renderTime, 15);
    assert.equal(sample.from.state, "b");
    assert.equal(sample.to.state, "c");
    assert.equal(sample.factor, 0.5);
  });

  it("uses factor 0 when the render time equals an interior snapshot", () => {
    const buffer = new SnapshotBuffer({ delay: 10 });
    buffer.push(0, "a");
    buffer.push(10, "b");
    buffer.push(20, "c");
    const sample = buffer.sample();
    assert.equal(sample.renderTime, 10);
    assert.equal(sample.from.state, "b");
    assert.equal(sample.to.state, "c");
    assert.equal(sample.factor, 0);
  });

  it("uses the newest snapshot when delay is 0", () => {
    const buffer = new SnapshotBuffer({ delay: 0 });
    buffer.push(0, "a");
    buffer.push(10, "b");
    const sample = buffer.sample();
    assert.equal(sample.status, "bracket");
    assert.equal(sample.renderTime, 10);
    assert.equal(sample.from, buffer.newest);
    assert.equal(sample.to, buffer.newest);
    assert.equal(sample.factor, 0);
  });

  it("holds the only snapshot when delay is 0", () => {
    const buffer = new SnapshotBuffer();
    const state = { x: 3 };
    buffer.push(42, state);
    const sample = buffer.sample();
    assert.equal(sample.status, "bracket");
    assert.equal(sample.renderTime, 42);
    assert.equal(sample.from, sample.to);
    assert.equal(sample.from.state, state);
    assert.equal(sample.factor, 0);
  });

  it("reports before when the render time is earlier than the oldest snapshot", () => {
    const buffer = new SnapshotBuffer({ delay: 21 });
    buffer.push(0, "a");
    buffer.push(10, "b");
    buffer.push(20, "c");
    const sample = buffer.sample();
    assert.deepEqual(sample, {
      status: "before",
      renderTime: -1,
      from: buffer.oldest,
      to: buffer.oldest,
      factor: null,
      overshoot: null,
      shortfall: 1,
    });
  });

  it("reports before for one snapshot and a positive delay", () => {
    const buffer = new SnapshotBuffer({ delay: 15 });
    buffer.push(100, "only");
    const sample = buffer.sample();
    assert.equal(sample.status, "before");
    assert.equal(sample.renderTime, 85);
    assert.equal(sample.from.state, "only");
    assert.equal(sample.to.state, "only");
    assert.equal(sample.shortfall, 15);
  });

  it("stays a bracket when the render time equals the oldest snapshot", () => {
    const buffer = new SnapshotBuffer({ delay: 20 });
    buffer.push(0, "a");
    buffer.push(10, "b");
    buffer.push(20, "c");
    const sample = buffer.sample();
    assert.equal(sample.status, "bracket");
    assert.equal(sample.renderTime, 0);
    assert.equal(sample.from.state, "a");
    assert.equal(sample.to.state, "b");
    assert.equal(sample.factor, 0);
    assert.equal(sample.shortfall, null);
  });

  it("reports extrapolation when a negative delay places render time past the newest", () => {
    const buffer = new SnapshotBuffer({ delay: -5 });
    buffer.push(0, "a");
    buffer.push(10, "b");
    buffer.push(20, "c");
    const sample = buffer.sample();
    assert.equal(sample.status, "extrapolate");
    assert.equal(sample.renderTime, 25);
    assert.equal(sample.from.state, "b");
    assert.equal(sample.to.state, "c");
    assert.equal(sample.to, buffer.newest);
    assert.equal(sample.factor, null);
    assert.equal(sample.overshoot, 5);
    assert.equal(sample.shortfall, null);
  });

  it("reports extrapolation without an earlier snapshot when only one is stored", () => {
    const buffer = new SnapshotBuffer({ delay: -8 });
    buffer.push(4, "only");
    const sample = buffer.sample();
    assert.equal(sample.status, "extrapolate");
    assert.equal(sample.renderTime, 12);
    assert.equal(sample.from, null);
    assert.equal(sample.to.state, "only");
    assert.equal(sample.overshoot, 8);
  });

  it("changes the sample when delay changes and does not remove snapshots", () => {
    const buffer = new SnapshotBuffer({ delay: 0, capacity: 4 });
    buffer.push(100, "a");
    buffer.push(200, "b");
    assert.equal(buffer.sample().status, "bracket");
    buffer.delay = 150;
    const behind = buffer.sample();
    assert.equal(behind.status, "before");
    assert.equal(behind.shortfall, 50);
    buffer.delay = -25;
    const ahead = buffer.sample();
    assert.equal(ahead.status, "extrapolate");
    assert.equal(ahead.overshoot, 25);
    assert.equal(ahead.from.state, "a");
    assert.equal(ahead.to.state, "b");
    assert.equal(buffer.size, 2);
  });

  it("follows the newest snapshot as later snapshots arrive", () => {
    const buffer = new SnapshotBuffer({ delay: 100 });
    buffer.push(1000, { x: 0 });
    buffer.push(1100, { x: 10 });
    let sample = buffer.sample();
    assert.equal(sample.renderTime, 1000);
    assert.equal(sample.from.time, 1000);
    assert.equal(sample.to.time, 1100);
    assert.equal(sample.factor, 0);

    buffer.push(1200, { x: 30 });
    sample = buffer.sample();
    assert.equal(sample.renderTime, 1100);
    assert.equal(sample.from.time, 1100);
    assert.equal(sample.to.time, 1200);
    assert.equal(sample.factor, 0);
  });

  it("produces a quarter factor on an uneven span", () => {
    const buffer = new SnapshotBuffer({ delay: 6 });
    buffer.push(0, 0);
    buffer.push(8, 80);
    const sample = buffer.sample();
    assert.equal(sample.renderTime, 2);
    assert.equal(sample.factor, 0.25);
    assert.equal(lerp(sample.from.state, sample.to.state, sample.factor), 20);
  });

  it("finds the surrounding pair inside a long buffer", () => {
    const buffer = new SnapshotBuffer({ capacity: 200, delay: 655 });
    for (let time = 0; time <= 1000; time += 10) {
      buffer.push(time, time);
    }
    const sample = buffer.sample();
    assert.equal(sample.status, "bracket");
    assert.equal(sample.renderTime, 345);
    assert.equal(sample.from.time, 340);
    assert.equal(sample.to.time, 350);
    assert.equal(sample.factor, 0.5);
  });

  it("keeps the factor inside 0..1 for every in-range render time", () => {
    const buffer = new SnapshotBuffer({ capacity: 100 });
    for (let index = 0; index < 50; index += 1) {
      buffer.push(index * 3 + 0.5, index);
    }
    const oldest = buffer.oldest.time;
    const newest = buffer.newest.time;
    for (let delay = 0; delay <= newest - oldest; delay += 0.25) {
      buffer.delay = delay;
      const sample = buffer.sample();
      assert.equal(sample.status, "bracket");
      assert.ok(sample.factor >= 0 && sample.factor <= 1);
      assert.ok(sample.from.time <= sample.renderTime);
      assert.ok(sample.to.time >= sample.renderTime);
      assert.equal(sample.renderTime, newest - delay);
    }
    buffer.delay = newest - oldest + 0.25;
    const before = buffer.sample();
    assert.equal(before.status, "before");
    assert.ok(before.shortfall > 0);
    assert.equal(before.shortfall, buffer.oldest.time - before.renderTime);
  });

  it("reports a positive overshoot for negative delays", () => {
    const buffer = new SnapshotBuffer({ capacity: 20 });
    for (let time = 0; time <= 40; time += 4) {
      buffer.push(time, time);
    }
    for (const delay of [-0.5, -1, -10, -100]) {
      buffer.delay = delay;
      const sample = buffer.sample();
      assert.equal(sample.status, "extrapolate");
      assert.equal(sample.overshoot, -delay);
      assert.equal(sample.renderTime, buffer.newest.time - delay);
      assert.equal(sample.to, buffer.newest);
      assert.equal(sample.from.time, buffer.newest.time - 4);
    }
  });

  it("does not sample a snapshot removed by age", () => {
    const buffer = new SnapshotBuffer({ delay: 100, maxAge: 50, capacity: 10 });
    buffer.push(0, "gone");
    buffer.push(1000, "kept");
    const sample = buffer.sample();
    assert.equal(sample.status, "before");
    assert.equal(sample.from.state, "kept");
    assert.equal(sample.shortfall, 100);
    assert.equal(buffer.size, 1);
  });

  it("returns snapshot records that match oldest and newest", () => {
    const buffer = new SnapshotBuffer({ delay: 0 });
    buffer.push(1, "a");
    buffer.push(2, "b");
    assert.equal(buffer.oldest, buffer.snapshots[0]);
    assert.equal(buffer.newest, buffer.snapshots[1]);
    const copy = buffer.snapshots;
    copy.pop();
    assert.equal(buffer.size, 2);
    assert.equal(buffer.sample().from, buffer.newest);
    assert.equal(buffer.sample().to, buffer.newest);
  });

  it("keeps separate buffers independent", () => {
    const first = new SnapshotBuffer({ delay: 0 });
    const second = new SnapshotBuffer({ delay: 5 });
    first.push(10, "a");
    second.push(3, "b");
    assert.equal(first.sample().from.state, "a");
    assert.equal(second.sample().status, "before");
    assert.equal(first.size, 1);
    assert.equal(second.size, 1);
  });
});

describe("clock and runtime isolation", () => {
  it("does not read a clock while pushing or sampling", () => {
    const originalNow = Date.now;
    const originalPerformance = globalThis.performance;
    Date.now = () => {
      throw new Error("clock called");
    };
    globalThis.performance = {
      now() {
        throw new Error("clock called");
      },
    };
    try {
      const buffer = new SnapshotBuffer({
        delay: 50,
        capacity: 4,
        maxAge: 500,
      });
      assert.equal(buffer.push(1000, { x: 1 }), true);
      assert.equal(buffer.push(1100, { x: 2 }), true);
      const sample = buffer.sample();
      assert.equal(sample.status, "bracket");
      assert.equal(sample.renderTime, 1050);
      assert.equal(sample.factor, 0.5);
    } finally {
      Date.now = originalNow;
      globalThis.performance = originalPerformance;
    }
  });

  it("has no clock, network, or I/O usage in the source", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../src/index.js", import.meta.url)),
      "utf8",
    );
    const patterns = [
      /\bDate\b/,
      /\bperformance\b/,
      /\bfetch\b/,
      /\brequire\b/,
      /\bprocess\b/,
      /\bsetTimeout\b/,
      /\bsetInterval\b/,
      /\bqueueMicrotask\b/,
      /\bXMLHttpRequest\b/,
      /\bWebSocket\b/,
      /\bchild_process\b/,
      /\bdgram\b/,
      /\bfs\b/,
      /\bnet\b/,
      /\bhttp\b/,
      /^\s*import\s/m,
    ];
    for (const pattern of patterns) {
      assert.equal(pattern.test(source), false, pattern.source);
    }
  });
});

describe("lerp", () => {
  it("blends finite numbers", () => {
    assert.equal(lerp(0, 10, 0), 0);
    assert.equal(lerp(0, 10, 1), 10);
    assert.equal(lerp(0, 10, 0.5), 5);
    assert.equal(lerp(10, 0, 0.25), 7.5);
    assert.equal(lerp(5, 5, 0.3), 5);
    assert.equal(lerp(-4, 4, 0.5), 0);
  });

  it("accepts a factor outside 0..1", () => {
    assert.equal(lerp(0, 10, 2), 20);
    assert.equal(lerp(0, 10, -1), -10);
  });

  it("rejects non-finite inputs", () => {
    assert.throws(() => lerp(Number.NaN, 1, 0), {
      name: "TypeError",
      message: "from must be a finite number",
    });
    assert.throws(() => lerp(0, Infinity, 0), {
      name: "TypeError",
      message: "to must be a finite number",
    });
    assert.throws(() => lerp(0, 1, "0.5"), {
      name: "TypeError",
      message: "factor must be a finite number",
    });
  });
});
