import test, { describe, it } from "node:test";
import assert from "node:assert"
import "./polyfill.js";

test("polyfill has added globals", () => {
    assert.equal(typeof globalThis.CompositeKey, "function");
    assert.equal(typeof globalThis.Record, "function");
    assert.equal(typeof globalThis.Tuple, "function");
    assert.equal(typeof globalThis.Symbol.keyBy, "symbol");
});

test("Map still works as usual", () => {
    let key = {};
    let value = 42;
    const m = new Map([[key, value]]);
    assert(m.has(key));
    assert.equal(m.get(key), 42);
    assert.equal(m.size, 1);
    m.set({}, 99);
    assert.equal(m.size, 2);
});

test("Map keyBy function", () => {
    let objA = {
        actual: "a",
        uuid: 1
    };
    let objB = {
        actual: "b",
        uuid: 1
    };
    const m = new Map([], { keyBy: v => v.uuid });
    m.set(objA, 99);

    assert.equal(m.get(objA), 99);
    assert.equal(m.get(objB), 99);

    const entries = [...m];
    assert.deepStrictEqual(entries, [[{ actual: "a", uuid: 1 }, 99]]);
    assert.strictEqual(entries.at(0).at(0), objA);
});

test("Set still works as usual", () => {
    let key = {};
    const s = new Set([key]);
    assert(s.has(key));
    assert.equal(s.size, 1);
    s.add({}, 99);
    assert.equal(s.size, 2);
});

test("Set keyBy ", () => {
    const s = new Set([], { keyBy: v => v.id });
    s.add({id: 1});
    assert(s.has({id: 1}));
    const values = [...s];
    assert.deepStrictEqual(values, [{ id: 1 }]);
});

describe("CompositeKey", (t) => {
    it("has opaque instances", () => {
        let keys = Reflect.ownKeys(new CompositeKey(1, 2));
        assert.deepEqual(keys, []);
    });
    it("brand check", () => {
        function isCompositeKey(v) {
            if (v === null || typeof v !== "object") {
                return false;
            }
            try {
                let d = Object.getOwnPropertyDescriptor(CompositeKey.prototype, Symbol.toStringTag);
                return d.get.call(v) === "CompositeKey";
            } catch {
                return false;
            }
        }
        assert(isCompositeKey(new CompositeKey()));
    });
    it("equality", () => {
        let obj = {};
        let k1 = new CompositeKey(1, obj);
        let k2 = new CompositeKey(1, obj);
        let k3 = new CompositeKey(9, obj);
        assert.notStrictEqual(k1, k2);
        assert(CompositeKey.equal(k1, k2));
        assert(!CompositeKey.equal(k1, k3));
    });
    it("ordinal", () => {
        let k1 = new CompositeKey(1, 2);
        let k2 = new CompositeKey(2, 1);
        assert(!CompositeKey.equal(k1, k2));
    });
    it("no prefix matching", () => {
        let k1 = new CompositeKey(1, 2);
        let k2 = new CompositeKey(1, 2, 3);
        assert(!CompositeKey.equal(k1, k2));
        assert(!CompositeKey.equal(k2, k1));
    });
    it("recursive equality", () => {
        let innerKey1 = new CompositeKey(1);
        let innerKey2 = new CompositeKey(1);
        let outerKey1 = new CompositeKey(2, innerKey1);
        let outerKey2 = new CompositeKey(2, innerKey2);
        let outerKey3 = new CompositeKey(2, 1);
        assert(CompositeKey.equal(outerKey1, outerKey2));
        assert(!CompositeKey.equal(outerKey1, outerKey3));
    });
});

describe("Map + CompositeKey", () => {
    it("CK are treated as normal objects by default", () => {
        let key1 = new CompositeKey(1);
        let key2 = new CompositeKey(1);
        let m = new Map();
        m.set(key1, 42);
        assert.equal(m.get(key1), 42);
        assert(!m.has(key2));
    });
    it("CK are handled specially by keyBy lookups", () => {
        let m = new Map([], { keyBy: v => v["key"] });
        let objA = {
            key: new CompositeKey(1),
        };
        let objB = {
            key: new CompositeKey(1),
        };
        m.set(objA, 42);
        assert.equal(m.get(objB), [42]);
    });
});

describe("Record", () => {
    it("small record", () => {
        let rec1 = Record({
            x: 1,
            y: 1
        });
        assert(Object.isFrozen(rec1));
        assert.deepEqual(rec1, {
            x: 1,
            y: 1
        });

        let rec2 = Record({
            x: 1,
            y: 1
        });
        assert.notStrictEqual(rec1, rec2);

        let key1 = rec1[Symbol.keyBy]();
        assert(key1 instanceof CompositeKey);

        let key2 = rec2[Symbol.keyBy]();
        assert(key2 instanceof CompositeKey);
    });
    it("nests", () => {
        let innerRec1 = Record({
            inner: true
        });
        let innerRec2 = Record({
            inner: true
        });
        let outerRec1 = Record({
            outer: true,
            child: innerRec1
        });
        let outerRec2 = Record({
            outer: true,
            child: innerRec2
        });

        assert(CompositeKey.equal(
            outerRec1[Symbol.keyBy](),
            outerRec2[Symbol.keyBy](),
        ));
    });
    it("registered symbols are allowed and are part of the equality", (t) => {
        let rec1 = Record({ [Symbol.for("a")]: "a", [Symbol.for("b")]: "b" });
        let rec2 = Record({ [Symbol.for("b")]: "b", [Symbol.for("a")]: "a" });
        let rec3 = Record({ [Symbol.for("b")]: "b", [Symbol.for("c")]: "c" });

        // order is preserved
        assert.deepStrictEqual(Reflect.ownKeys(rec1), [Symbol.for("a"), Symbol.for("b"), Symbol.keyBy]);
        assert.deepStrictEqual(Reflect.ownKeys(rec2), [Symbol.for("b"), Symbol.for("a"), Symbol.keyBy]);

        assert(CompositeKey.equal(
            rec1[Symbol.keyBy](),
            rec2[Symbol.keyBy](),
        ));

        // different symbols -> not equal
        assert(!CompositeKey.equal(
            rec2[Symbol.keyBy](),
            rec3[Symbol.keyBy](),
        ));
    });
    it("non-registered symbols are allowed and are part of the equality", (t) => {
        let s1 = Symbol();
        let s2 = Symbol();
        let s3 = Symbol();

        let rec1 = Record({ [s1]: 1, [s2]: 2 });
        let rec2 = Record({ [s2]: 2, [s1]: 1 });
        let rec3 = Record({ [s2]: 2, [s3]: 3 });

        // order is preserved
        assert.deepStrictEqual(Reflect.ownKeys(rec1), [s1, s2, Symbol.keyBy]);
        assert.deepStrictEqual(Reflect.ownKeys(rec2), [s2, s1, Symbol.keyBy]);

        // order doesn't impact equality
        assert(CompositeKey.equal(
            rec1[Symbol.keyBy](),
            rec2[Symbol.keyBy](),
        ));

        // different symbols -> not equal
        assert(!CompositeKey.equal(
            rec2[Symbol.keyBy](),
            rec3[Symbol.keyBy](),
        ));
    });
});

test("Tuple", () => {
    let tup1 = Tuple(1, 2);
    assert(Object.isFrozen(tup1));
    assert.deepEqual(tup1, [1, 2]);
    assert(Array.isArray(tup1));

    let tup2 = Tuple(1, 2);
    assert.notStrictEqual(tup1, tup2);

    let key1 = tup1[Symbol.keyBy]();
    assert(key1 instanceof CompositeKey);

    let key2 = tup2[Symbol.keyBy]();
    assert(key2 instanceof CompositeKey);
});

test("Map.usingKeys + Record", () => {
    let rec1 = Record({ x: 1, y: 1 });
    let rec2 = Record({ x: 1, y: 1 });

    let m = Map.usingKeys();

    m.set(rec1, 42);
    assert.equal(m.get(rec2), 42);
});
