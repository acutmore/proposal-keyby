let k1 = new CompositeKey("key");
let k2 = new CompositeKey("key");

let keysEqual = CompositeKey.equal(k1, k2);
console.log("CompositeKey.equal", keysEqual); // true
console.log("=== equal", k1 === k2); // false

let r1 = Record({ x: 1 });
let r2 = Record({ x: 1 });

let m = new Map([], { keyBy: Symbol.keyBy });

m.set(r1, 42);
console.log("mapGet: ", m.get(r2)); //42

for (const [k, v] of m) {
    console.log(k, v); // r1, 42
}
