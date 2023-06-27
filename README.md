
# Proposal KeyBy

This is a different take on https://github.com/tc39/proposal-richer-keys, looking at the same problem of "richer keys".

## The issue

Right now `Map` and `Set` always use SameValueZero for their internal equality predicate for answering "Is this value in this collection?".

```js
new Set([42, 42]).size === 1;

let m = new Map();
m.set("hello", "world");
m.get("hello") === "world";
```

This means that when it comes to objects, all objects are only equal to themselves. There is no capability to override this behavior and allow two different objects to be treated equal within the collection.

```js
let item1 = {
    position: Object.freeze({ x: 0, y: 0 }),
};
let item2 = {
    position: Object.freeze({ x: 0, y: 0 }),
};

const positions = new Set([item1.position, item2.position]);
positions.size; // 2
```

In Python:

```py
position1 = (0, 0)
position2 = (0, 0)

positions = set()
positions.add(position1)
positions.add(position2)

print(len(positions)) # 1
```

Clojure:

```clj
cljs.user=> (def position1 (list 0 0))
cljs.user=> (def position2 (list 0 0))
cljs.user=> (count (set (list position1 position2)))
> 1
```

### Current workaround

One way to work around this limitation in JavaScript is to construct a string representation of the value.

```js
const positions = new Set([JSON.stringify(item1.position), JSON.stringify(item2.position)]);
positions.size; // 1
```

The downsides of this are:

- It can be easy to construct incorrect strings, for example `JSON.stringify` will produce a different string if the object keys are enumerated in a different order.
- The collection now contains strings and not structured objects. To read the values back out they would need to be parsed.

## Proposal Ideas:

There are a collection of ideas here. These can be broken down into separate but composable proposals.
Listing all of them here is to set out a vision of where we could end up in the future, to check how everything fits together.

### CompositeKey (phase 1)

Introduce a `CompositeKey` type. This type can represent the compound equality of a sequence of values.

```js
let key1 = new CompositeKey(0, 0);
let key2 = new CompositeKey(0, 0);
let key3 = new CompositeKey(0, 1);
key1 !== key2; // separate objects
CompositeKey.equal(key1, key2); // true
CompositeKey.equal(key1, key3); // false
Reflect.ownKeys(key1); // [] - opaque empty object from the outside
key1 instanceof CompositeKey; // true
Object.isFrozen(key1); // false
```

### Map and Set config (phase 1)

Allow `Map` and `Set` instances to be customized with a lookup function that will produce the value that represents the keys values for that collection. In this mode the representative values are considered equal if they are `SameValueZero` equal, or if they are both `CompositeKey`s and equal according to `CompositeKey.equal`.

```js
let positions = new Set([], { keyBy: ({x, y}) => new CompositeKey(x, y), });

positions.add({ x: 0, y: 0, z: 1 });
positions.add({ x: 0, y: 0, z: 99 }); // 'z' prop is not inspected by the keyBy function
positions.add({ x: 0, y: 1 });

positions.values().toArray(); // [{ x: 0, y: 0, z: 1 }, { x:0, y: 1 }]
```

### Symbol.keyBy (follow on?)

Introduce a new Well-known Symbol to act as a co-ordination point for the ecosystem.

```js

class Position {
    x;
    y;

    constructor(x, y) {
        this.x = x;
        this.y = y;
    }

    get [Symbol.keyBy]() {
        return new CompositeKey(Position, this.x, this.y);
    }
}

let positions = new Set([], { keyBy: Symbol.keyBy });
positions.add(new Position(0, 0));
positions.has(new Position(0, 0)); // true
```

There could potentially be a built-in decorator to aid classes in keeping their `Symbol.keyBy` protocol up-to-date as new fields are added.

```js
class Position {
    @CompositeKey.decorator
    x;
    @CompositeKey.decorator
    y;

    constructor(x, y) {
        this.x = x;
        this.y = y;
    }

    @CompositeKey.decorator
    get [Symbol.keyBy]() {}
}
```

### Records and Tuples (follow on?)

We can also have built in values that implicitly implement the `Symbol.keyBy` protocol.

```js

let r1 = #{ x: 0, y: 0, offset: #[0, 0] };
let r2 = #{ x: 0, y: 0, offset: #[0, 0] };

CompositeKey.isKey(r1[Symbol.keyBy]); // true
Object.isFrozen(r1); // true
r1.x; // 0
r1 === r2; // false

let s = new Set([r1], { keyBy: Symbol.keyBy });
s.has(r2); // true
```

The built-in `keyBy` implementation of these types will also look up `Symbol.keyBy` on the values within the Record/Tuple.

### Existing Types (follow on?)

Immutable values types such as those in Temporal can implement `Symbol.keyBy`, without requiring users to work out the best way to represent these types using a `CompositeKey`.

## Q+A

- Why does `new CompositeKey` always return a fresh object
    - This allows any hashing and equality operations to be done lazily on API access. Compared to `CompositeKey(0) === CompositeKey(0)`, which would require either an eager global intern-table or for `===` to be have a special overload for these objects.
- Why are the `Map` and `Set` changes opt-in, and do not work with existing default constructors `new Map()` and `new Set()`?
    - Adding `Symbol.keyBy` to an object could invalidate existing code that assumes `Map` and `Set` will use object identity.
    - The opt-in mode can be strict, and throw an Error if a value does not implement `Symbol.keyBy` rather than silently falling back to object identity.
- Why not have a more traditional API where values implement a `hash()` and `equals(other)` methods?
    - A risk in implementing these methods separately is that they can be mis-aligned if one method is updated/refactored and the other isn't. Resulting in values that are equal but don't have match `hash` values.
    - A `CompositeKey` can be thought of as a type that implements these on behalf of the user, ensuring that the two methods are aligned and equality follows the rules of reflectivity, symmetry, transitivity and consistency.
    - The downside to this is that when comparing if two values are equal by comparing their `CompositeKeys`, both values need to produce a full `CompositeKey` rather than doing this gradually and exiting early as soon as one part does not match. A separate API for this use case could avoid this issue.
- What about `WeakMap` and `WeakSet`?
    - More investigation required.
    - a `keyBy` function for these makes less sense because if the function returns a new value then the only reference to that value will be held weakly and therefore eligible for collection.
    - A `new CompositeKey(0, 0)` does not hold any lifetime information, a matching `CompositeKey` can always be created if the _inputs_ are available.
    - Allowing only `CompositeKeys` that were created from at least one value that itself is allowed as a `WeakMap` key could be an option.
