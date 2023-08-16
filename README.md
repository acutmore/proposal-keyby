
# Proposal KeyBy

This is a different take on https://github.com/tc39/proposal-richer-keys, looking at the same problem of "richer keys".

## The issue

Right now `Map` and `Set` always use [SameValueZero](https://tc39.es/ecma262/multipage/abstract-operations.html#sec-samevaluezero) for their internal equality predicate answering "Is this value in this collection?".

```js
new Set([42, 42]).size; // 1
new Set([{}, {}]).size; // 2;

let m = new Map();

m.set("hello", "world");
m.set({}, "object");

m.get("hello"); // "world";
m.has({});      // false
```

As shown above, this means that when it comes to objects, all objects are only equal to themselves. There is no capability to override this behavior and allow two different objects to be treated equal within the collection.

```js
let position1 = Object.freeze({ x: 0, y: 0 });
let position2 = Object.freeze({ x: 0, y: 0 });

let positions = new Set([position1, position2]);
positions.size; // 2
```

Whereas in Python:

```py
position1 = (0, 0)
position2 = (0, 0)

positions = set()
positions.add(position1)
positions.add(position2)

print(len(positions)) # 1
```

or Clojure:

```clj
(def position1 '(0 0))
(def position2 '(0 0))
(count (set [position1 position2])) ; 1
```

### Current workaround

One way to work around this limitation in JavaScript is to construct a string representation of the value.

```js
const positions = new Set([JSON.stringify(position1), JSON.stringify(position2)]);
positions.size; // 1
```

The downsides of this are:

- It can be easy to construct incorrect strings, for example `JSON.stringify` will produce a different string if the object keys are enumerated in a different order or throw if the value does not have a built-in JSON representation.
- The collection now contains strings and not structured objects. To read the values back out they would need to be parsed.

Alternatively two collections can be used, one to track uniqueness and another to track values:

```js
const positions = [];
const positionKeys = new Set();
function add(position) {
    const asString = JSON.stringify(position);
    if (positionKeys.has(asString)) return;
    positions.push(position);
    positionKeys.add(asString);
}
```

The downsides of this are:

- Code needs to ensure the two collections are kept in-sync with each other.
- Extra noise/boilerplate to follow this pattern
- Same risk as above of flattening a value to a string

## Proposal Ideas:

There are a collection of ideas here. These can be broken down into separate but composable proposals; or delivered all together as one proposal.
Listing all of them here is to set out a vision of where we could end up in the future, to check how everything fits together.

### Map and Set config (phase 1)

Allow `Map` and `Set` instances to be customized with a lookup function that will produce the value that will internally represent the key's uniqueness for that collection.

```js
let keyBySet = new Set([], { keyBy: (v) => v.uuid, });
keyBySet.add({ uuid: "ABCDE" });
keyBySet.has({ uuid: "ABCDE" }); // true
[...keyBySet];                   // [{ uuid: "ABCDE" }]
```

This addresses the issue of using two separate collections to achieve these semantics.

### CompositeKey (phase 1)

Introduce a `CompositeKey` type. This type can represent the compound equality of a sequence of values.

```js
let key1 = new CompositeKey(0, 0);
let key2 = new CompositeKey(0, 0);
let key3 = new CompositeKey(0, 1);
key1 !== key2;                       // true (separate objects)
CompositeKey.equal(key1, key2);      // true
CompositeKey.equal(key1, key3);      // false
Reflect.ownKeys(key1);               // []   (opaque empty object from the outside)
key1 instanceof CompositeKey;        // true
Object.isFrozen(key1);               // false (the key's value is internal+private)
```

This pairs nicely with the `Map`/`Set` config, allowing for more interesting keys. When the `keyBy` function returns a `CompositeKey` it is not compared with other values using `SameValueZero` but by the equality of two `CompositeKey`s.

```js
let positions = new Set([], { keyBy: ({x, y}) => new CompositeKey(x, y) });
positions.add(position1);
positions.add(position2);
positions.size;                     // 1
[...positions].at(0) === position1; // true
```

`CompositeKey` can be nested recursively with the resulting 'structure' participating in the equality. A _CompositeTree_ if you will.

```js
let key1 = new CompositeKey(1, new CompositeKey(2, 3));
let key2 = new CompositeKey(1, new CompositeKey(2, 3));

CompositeKey.equal(key1, key2); // true

let key3 = new CompositeKey(1, 2, 3);
CompositeKey.equal(key1, key3); // false (nesting keys does not flatten them)
```

### Symbol.keyBy (follow on?)

While being able to customize the `keyBy` function when constructing the collection provides flexibility, it may be common that the values themselves are best placed to define how their `CompositeKey` should be constructed to help ensure correctness.

```js
let positions = new Set([], { keyBy: ({x, y}) => new CompositeKey(x, y), });

positions.add({ x: 0, y: 0, z: 1 });
positions.add({ x: 0, y: 0, z: 99 }); // 'z' prop is not inspected by the keyBy function
positions.add({ x: 0, y: 1 });

positions.values().toArray(); // [{ x: 0, y: 0, z: 1 }, { x:0, y: 1 }]
```

Introduce a new well-known Symbol to act as a co-ordination point.

```js
class Position {
    x;
    y;

    constructor(x, y) {
        this.x = x;
        this.y = y;
    }

    [Symbol.keyBy]() {
        return new CompositeKey(Position, this.x, this.y);
    }
}

let positions = Set.usingKeys(); // name to be bike-shedded
// ~sugar for:
let positions = new Set([], { keyBy: (v) => v[Symbol.keyBy](), });

positions.add(new Position(0, 1));
positions.add(new Position(0, 1));
positions.add(new Position(0, 2));
positions.size; // 2
```

There can be `CompositeKey` static factory that looks up the this symbol on the arguments keeping the constructor the minimal required functionality.

```js
CompositeKey.of(position1, position2);

// ~sugar for:
function lookupKey(v) {
    if (Object(v) === v) {
        let keyBy = v[Symbol.keyBy];
        return typeof keyBy === "function"
            ? Reflect.apply(keyBy, v, [])
            : v; // or throw if no keyBy protocol ?
    } else {
        return v;
    }
}
new CompositeKey(lookupKey(position1), lookupKey(position2));
```

There could potentially be a built-in decorator to aid classes in keeping their `Symbol.keyBy` protocol up-to-date as new fields are added.

```js
class Position {
    @CompositeKey.field
    x;
    @CompositeKey.field
    y;
    @CompositeKey.field
    z;

    constructor(x, y, z) {
        this.x = x;
        this.y = y;
        this.z = z;
    }

    [Symbol.keyBy]() {
        return CompositeKey.keyFor(this); // no need to update as new fields are added
    }
}
```

### Records and Tuples (follow on?)

We can also have built in immutable values that take this further by implicitly implementing the `Symbol.keyBy` protocol to further reduce common boilerplate and help ensure correctness.

```js
let r1 = #{ x: 0, y: 0, offset: #[0, 0] };
let r2 = #{ x: 0, y: 0, offset: #[0, 0] };

Object.isFrozen(r1); // true
r1.x;                // 0
r1 === r2;           // false

r1[Symbol.keyBy]() instanceof CompositeKey; // true

let s = Set.usingKeys([r1]);
s.has(r2);           // true
```

The built-in `keyBy` implementation of these types will also look up `Symbol.keyBy` on the values within the Record/Tuple.

### Existing Types (follow on?)

Immutable values types such as those in Temporal could implement `Symbol.keyBy`, without requiring users to work out the best way to represent these types using a `CompositeKey`.

## Q+A

- Why does `new CompositeKey` always return a fresh object
    - This allows any hashing and equality operations to be done lazily on API access. Compared to `CompositeKey(0) === CompositeKey(0)`, which would require either an eager global intern-table or for `===` to be have a special overload for these objects.
- Why are the `Map` and `Set` changes opt-in, and do not work with existing default constructors `new Map()` and `new Set()`?
    - Adding `Symbol.keyBy` to an object could invalidate existing code that assumes existing `Map` and `Set` will use object identity.
    - The opt-in mode can be strict, and throw an Error if a value does not implement `Symbol.keyBy` rather than silently falling back to object identity.
- Why not have a more traditional API where values implement a `hash()` and `equals(other)` methods?
    - A risk in implementing these methods separately is that they can be mis-aligned if one method is updated/refactored and the other isn't. Resulting in values that are equal but don't have match `hash` values.
        - A `CompositeKey` can be thought of as a type that implements these on behalf of the user, ensuring that the two methods are aligned and equality follows the rules of reflectivity, symmetry, transitivity and consistency.
        - The downside to this is that when comparing if two values are equal by comparing their `CompositeKeys`, both values need to produce a full `CompositeKey` rather than doing this gradually and exiting early as soon as one part does not match. A separate API for this use case could avoid this issue.
    - ECMA262 aims to be as deterministic as possible (`Date.now()` and `Math.random()` being examples of the few exceptions) and backwards-compatible with previous versions; this would mean that built-in hash functions would most likely need to be fully specified and limited ability to evolve the hashing algorithm. Exposing these low level details _may_ also pose a security risk.
    - It may be possible for `Record` and `Tuple`'s keys to still use a hash+equals approach under the hood. Even if the observable behavior is that they are producing `CompositeKey`.
- How does this compare to the original Record&Tuple proposal?
    - Here R&T are just plain objects and arrays, not primitives
    - They do not enforce deeply immutable structures
    - They can contain any value, including functions
    - They do not compare using `===`, likely making them simpler for engines to implement
- What about mutability?
    - It is only strongly encouraged that `Symbol.keyBy` is implemented on values that are not mutated so that it behaves consistency. There is no protection against a badly behaving `Symbol.keyBy` method.
    - This is like most other languages that come with similar warnings when manually implementing methods like `hashcode`, `equals`, `compare` etc.
- What about membranes?
    - More investigation required.
    - Out of the box `CompositeKey` won't work across membranes because their uniqueness is encoded within an internal slot. Membranes would need to add explicit support for re-constructing CompositeKeys when used across a membrane.
- What about `WeakMap` and `WeakSet`?
    - More investigation required.
    - Not all `CompositeKey`s would carry object information. So it it might be that only `CompositeKeys` that were created from at least one value that itself is allowed as a `WeakMap` key would be permissable as a `WeakMap` key.
