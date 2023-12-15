// $ node -r ./polyfill.js example.js

let k1 = new CompositeKey("key");
let k2 = new CompositeKey("key");

let keysEqual = CompositeKey.equal(k1, k2);
console.log("CompositeKey.equal(k1, k2): ", keysEqual); // true
console.log("k1 === k2: ", k1 === k2); // false

let r1 = Record({ x: 1 });
let r2 = Record({ x: 1 });

let normalMap = new Map();
normalMap.set(r1, 42);
console.log("normalMap.get(r2): ", normalMap.get(r2)); // undefined

let keyedMap = Map.usingKeys();

keyedMap.set(r1, 42);
console.log("keyedMap.get(r2): ", keyedMap.get(r2)); // 42

for (const [k, v] of keyedMap) {
  console.log("key -> value: ", k, "->", v); // { x: 1 } -> 42
  console.log("key === r1: ", k === r1); // { x: 1 } -> 42
}
