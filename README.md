# @aneron/snap-lerp

Snapshot interpolation buffer for timestamped state.

## Purpose

`@aneron/snap-lerp` stores timestamped snapshots and returns the two records that surround a render time, plus a blend factor in the range 0..1. The render time is the newest stored timestamp minus a configured delay. The caller passes every timestamp. The package does not read a clock, blend snapshot state, open a socket, or touch the filesystem. It has no runtime dependencies.

## Install

```bash
npm install @aneron/snap-lerp
```

## Usage

```javascript
import { SnapshotBuffer, lerp } from "@aneron/snap-lerp";

const buffer = new SnapshotBuffer({
  delay: 150,
  capacity: 32,
  maxAge: 1000,
});

buffer.push(1000, { x: 0 });
buffer.push(1100, { x: 10 });
buffer.push(1200, { x: 30 });

const sample = buffer.sample();
if (sample.status === "bracket") {
  const x = lerp(sample.from.state.x, sample.to.state.x, sample.factor);
}
```

With those inputs the newest timestamp is 1200, so the render time is 1050. `sample.from` is the snapshot at 1000 and `sample.to` is the snapshot at 1100. `sample.factor` is 0.5, and `x` is 5.

```javascript
buffer.push(1150, { x: 99 });
```

That call returns `false`. 1150 is older than the newest stored timestamp, 1200, so the buffer ignores it.

```javascript
const ahead = new SnapshotBuffer({ delay: -20 });
ahead.push(100, { x: 0 });
ahead.push(200, { x: 10 });
const extra = ahead.sample();
```

`extra.status` is `"extrapolate"`. `extra.renderTime` is 220 and `extra.overshoot` is 20. `extra.from` is the snapshot at 100 and `extra.to` is the snapshot at 200.

```javascript
const behind = new SnapshotBuffer({ delay: 500 });
behind.push(1000, { x: 1 });
behind.push(1100, { x: 2 });
const early = behind.sample();
```

`early.status` is `"before"`. `early.renderTime` is 600 and `early.shortfall` is 400. `early.from` and `early.to` are both the oldest stored snapshot.

## API

### `new SnapshotBuffer(options)`

`options` is an object. All fields are optional.

| Field      | Default    | Meaning                                                                                                                         |
| ---------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `delay`    | `0`        | Number subtracted from the newest timestamp to produce the render time. Any finite number, including a negative number or zero. |
| `capacity` | `32`       | Maximum number of snapshots kept. An integer greater than or equal to 1.                                                        |
| `maxAge`   | `Infinity` | Maximum age kept, in the same units as the timestamps. `Infinity` or a finite number greater than or equal to 0.                |

The constructor throws a `TypeError` when `options` is not a plain object or a field has an invalid value. Passing `undefined` for a field selects the default.

Timestamps and `delay` use whatever unit the caller chooses. The buffer does not interpret them as milliseconds.

### `buffer.push(time, state)`

Stores `state` at `time` and returns `true` when `time` is a finite number and is strictly greater than the newest stored timestamp. The first snapshot in an empty buffer is accepted at any finite time.

Returns `false` when `time` is equal to or less than the newest stored timestamp. The buffer is left unchanged. `0` and `-0` count as the same timestamp.

Throws a `TypeError` when `time` is not a finite number. `state` may be any value, including `undefined`. It is stored by reference.

### `buffer.sample()`

Returns a plain object:

| Field        | Meaning                                                                        |
| ------------ | ------------------------------------------------------------------------------ |
| `status`     | `"empty"`, `"bracket"`, `"before"`, or `"extrapolate"`.                        |
| `renderTime` | Newest timestamp minus `delay`, or `null` when the buffer is empty.            |
| `from`       | Older snapshot of the pair, or `null`.                                         |
| `to`         | Newer snapshot of the pair, or `null`.                                         |
| `factor`     | Blend factor in the range 0..1 when `status` is `"bracket"`. Otherwise `null`. |
| `overshoot`  | `renderTime - newest.time` when `status` is `"extrapolate"`. Otherwise `null`. |
| `shortfall`  | `oldest.time - renderTime` when `status` is `"before"`. Otherwise `null`.      |

`status` values:

- `"empty"`: no snapshots are stored. Every other field is `null`.
- `"bracket"`: `oldest.time <= renderTime <= newest.time`. `from` is the latest snapshot at or before `renderTime`. `to` is the next snapshot, or `from` when `renderTime` is the newest timestamp or the only stored timestamp. `factor` is `(renderTime - from.time) / (to.time - from.time)` when those times differ, and `0` when they are equal. `lerp(from.state, to.state, factor)` therefore selects `from.state` at factor `0` and `to.state` at factor `1`.
- `"before"`: `renderTime` is strictly less than the oldest stored timestamp. `from` and `to` are that oldest snapshot. `shortfall` is greater than 0.
- `"extrapolate"`: `renderTime` is strictly greater than the newest stored timestamp. This happens when `delay` is negative. `to` is the newest snapshot. `from` is the snapshot immediately before it, or `null` when only one snapshot is stored. `overshoot` is greater than 0 and equals `-delay`.

### `buffer.clear()`

Removes every stored snapshot.

### `buffer.size`

Number of stored snapshots.

### `buffer.snapshots`

Shallow copy of the stored snapshot records, oldest first. Each record is `{ time, state }` and is frozen. The state value inside it is not copied.

### `buffer.oldest` and `buffer.newest`

The oldest and newest snapshot records, or `undefined` when the buffer is empty.

### `buffer.delay`, `buffer.capacity`, and `buffer.maxAge`

Read and write the constructor settings. A write throws a `TypeError` for an invalid value and leaves the previous value in place. Lowering `capacity` or `maxAge` removes snapshots immediately. Raising either limit does not restore snapshots that were already removed.

### `lerp(from, to, factor)`

Returns `from + (to - from) * factor` for finite numbers. `factor` is not limited to 0..1. Throws a `TypeError` when `from`, `to`, or `factor` is not a finite number.

The buffer does not call `lerp`. Snapshot state has no required shape, so the caller blends the fields it knows about.

## Design notes

The render time is `newest.time - delay`. `sample` takes no time argument. `push` is the only place a timestamp enters the buffer. The implementation does not call `Date.now`, `performance.now`, or any other clock.

A snapshot is stored only when its timestamp is strictly greater than the newest stored timestamp. An equal timestamp is a duplicate. A smaller timestamp is out of order. Both are ignored, including a timestamp that would have fallen in a gap opened by an earlier removal. Ignored calls do not drop other snapshots.

Age is `newest.time - snapshot.time`. After every accepted `push`, and after a write to `capacity` or `maxAge`, the buffer removes snapshots with age strictly greater than `maxAge`. A snapshot whose age equals `maxAge` stays. It then removes the oldest remaining snapshots until `size` is less than or equal to `capacity`. The newest snapshot has age 0, so age removal does not drop it. Both limits apply. Dropped snapshots are not kept elsewhere.

Comparison uses ordinary numeric `>` and `<=`. There is no epsilon. Ordering and equality are the IEEE-754 comparisons of the numbers the caller passed.

`factor` is clamped to 0..1 only to absorb a binary floating-point result that lands just outside that range. For timestamp differences that are exact in IEEE-754, the factor is the exact quotient.

When `status` is `"extrapolate"` and `from` is not `null`, the stored span is `to.time - from.time`. The render time lies `overshoot` past `to.time`. A numeric field can be extended with `lerp(fromValue, toValue, 1 + overshoot / span)`. When `from` is `null`, the buffer has no earlier snapshot to take a rate from.

When `status` is `"before"`, the render time lies `shortfall` before the oldest stored snapshot. The oldest state is `from.state`.

Snapshot records are frozen. Their `state` values are not cloned and are not frozen. Mutating an object after `push` changes the value later returned by `sample`.

## License

MIT. Copyright (c) 2026 Vadim Gubin.
