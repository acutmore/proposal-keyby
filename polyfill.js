// @ts-check
/// <reference lib="es2022" />

(function () {
    const { Map: OriginalMap } = globalThis;

    /**
     * @type {<T>(f: () => T) => T}
     */
    const run = f => f();

    const symbolsAsWeakMapKeys = run(() => {
        try {
            // @ts-expect-error
            new WeakSet([Symbol()]);
            return true;
        } catch {
            return false;
        }
    });

    /** @return {boolean} */
    function isObject(v) {
        return (
            (typeof v === "object" && v !== null) ||
            typeof v === "function"
        );
    }

    /** @return {boolean} */
    function valueWithIdentity(v) {
        return (
            isObject(v) ||
            (symbolsAsWeakMapKeys && typeof v === "symbol" && Symbol.keyFor(v) !== undefined)
        );
    }

    /**
     * Generic WeakMap that tracks its size, and provides a callback when the the size changes to zero
     * @template K, V
     * @private
     */
    class CountingWeakMap {
        /** @type {WeakMap<K & object, V>} */
        #weakMap = new WeakMap();
        #fr = new FinalizationRegistry(() => this.#decrement());
        /** @type {() => void} */
        #onEmpty;
        #size = 0;

        /**
         * @param {() => void} onEmpty
         */
        constructor(onEmpty) {
            this.#onEmpty = onEmpty;
        }

        #increment(k) {
            this.#size++;
            this.#fr.register(k, null, k);
        }

        #decrement() {
            this.#size--;
            if (this.#size === 0) {
                this.#onEmpty();
            }
        }

        get size() {
            return this.#size;
        }

        /**
         * @param {K} k
         * @returns boolean
         */
        has(k) {
            return this.#weakMap.has(k);
        }

        /**
         * @param {K} k
         * @returns {V | undefined}
         */
        get(k) {
            return this.#weakMap.get(k);
        }

        /**
         * @param {K} k
         * @param {V} v
         * @returns {this}
         */
        set(k, v) {
            const newEntry = !this.#weakMap.has(k);
            this.#weakMap.set(k, v);
            if (newEntry) {
                this.#increment(k);
            }
            return this;
        }

        /**
         * @param {K} k
         * @returns boolean
         */
        delete(k) {
            const deleted = this.#weakMap.delete(k);
            if (deleted) {
                this.#fr.unregister(/** @type {object} */ (k));
                this.#decrement();
            }
            return deleted;
        }
    }

    /**
     * @template K
     * @template V
     * @typedef MapLike
     * @prop {(k:K) => boolean} has
     * @prop {(k:K) => V | undefined} get
     * @prop {(k:K, v:V) => MapLike<K, V>} set
     * @prop {(k:K) => boolean} delete
     * @prop {number} size
     */

    /**
     * @template K
     * @template V
     * @param {MapLike<K, V>} map
     * @param {K} key
     * @param {(k:K) => V} factory
     * @returns {V}
     */
    function mapGetOrInsert(map, key, factory) {
        if (!map.has(key)) {
            const v = factory(key);
            map.set(key, v);
            return v;
        }
        return /** @type {V} */ (map.get(key));
    }

    /**
     * @param {boolean} v
     * @returns {asserts v}
     */
    function assert(v) {
        if (v !== true) {
            throw new Error();
        }
    }

    /**
     * @typedef OpaqueId
     * @prop {"opaqueid"} __id__
     */

    /** @private */
    class AbstractNode {
        static #fr = new FinalizationRegistry((map) => {
            map.examineSelf();
        });

        /** @type {AbstractNode | null} */
        #parent;
        /** @type {unknown} */
        #keyInParent;

        /**
         * @protected
         * @type {WeakRef<OpaqueId> | undefined}
         */
        id;
        /**
         * @protected
         * @type {MapLike<unknown, AbstractNode>}
         */
        nextNode;

        /**
         * @param {{ map: MapLike<unknown, AbstractNode>, parent: AbstractNode | null, key: unknown }} params
         */
        constructor({ map, parent, key }) {
            if (new.target === AbstractNode) {
                throw new Error(`AbstractNode should be subclassed`);
            }
            this.#parent = parent;
            this.#keyInParent = key;
            this.nextNode = map;
        }

        /**
         * @protected
         * @returns {WeakRef<OpaqueId>}
         */
        generateId() {
            const id = Object.freeze(Object.create(null));
            AbstractNode.#fr.register(id, this);
            return new WeakRef(id);
        }

        /** @protected */
        examineSelf() {
            if (this.nextNode.size) return;
            if (this.id?.deref()) return;
            this.#parent?.purge(this.#keyInParent);
        }

        /** @protected */
        purge(key) {
            this.nextNode.delete(key);
            this.examineSelf();
        }

        /**
         * @param {unknown[]} values
         * @param {number} index
         * @returns {OpaqueId}
         */
        getId(values, index) {
            assert(index >= values.length);
            const id =
                this.id?.deref() ?? (this.id = this.generateId()).deref();
            assert(id !== undefined);
            return id;
        }
    }

    /** @private */
    class EternalNode extends AbstractNode {
        static #GCPlaceHolder = Symbol("<gc-value>");

        /**
         * @param {AbstractNode} parent
         * @param {unknown} key
         */
        constructor(parent, key) {
            super({
                map: new OriginalMap(),
                parent,
                key,
            });
        }

        /**
         * @override
         * @param {unknown[]} values
         * @param {number} index
         * @returns {OpaqueId}
         */
        getId(values, index = 0) {
            if (index >= values.length) {
                return super.getId(values, index);
            }

            let head = values[index];
            if (valueWithIdentity(head)) {
                head = EternalNode.#GCPlaceHolder;
            }
            const nextNode = mapGetOrInsert(
                this.nextNode,
                head,
                (k) => new EternalNode(this, k),
            );
            return nextNode.getId(values, index + 1);
        }
    }

    /** @private */
    class GCNode extends AbstractNode {
        static #transitionMarker = Object.freeze({"<transition>": true});

        /**
         * @param {AbstractNode | null} parent
         * @param {unknown} key
         */
        constructor(parent, key) {
            super({
                map: new CountingWeakMap(() => this.examineSelf()),
                parent,
                key,
            });
        }

        /**
         * @override
         * @param {unknown[]} values
         * @param {number} index
         * @returns {OpaqueId}
         */
        getId(values, index = 0, seenEternal = false) {
            if (index >= values.length) {
                if (seenEternal) {
                    // restart at 0 to process 'eternal values'
                    const nextNode = mapGetOrInsert(
                        this.nextNode,
                        GCNode.#transitionMarker,
                        (k) => new EternalNode(this, k),
                    );
                    return nextNode.getId(values, 0);
                }
                // end of the line
                return super.getId(values, index);
            }

            let head = values[index];
            if (!valueWithIdentity(head)) {
                // skip over, flagging that we did this
                return this.getId(values, index + 1, /* seenEternal: */ true);
            }
            head = isCompositeKey(head)
                ? getKeyIdentity(head)
                : head;
            const nextNode = mapGetOrInsert(
                this.nextNode,
                head,
                (k) => new GCNode(this, k),
            );
            return nextNode.getId(values, index + 1, seenEternal);
        }
    }

    /** @private */
    const SymbolKeyBy = Symbol("Symbol.keyBy");

    function trySymbol(v) {
        if (isObject(v)) {
            let k = v[SymbolKeyBy];
            return typeof k === "function" ? Reflect.apply(k, v, []) : v;
        }
        return v;
    }

    /** @type {(v: unknown) => v is CompositeKey} */
    let isCompositeKey;

    /** @type {(v: CompositeKey) => OpaqueId} */
    let getKeyIdentity;

    /** @public */
    class CompositeKey {
        static {
            /** @returns {v is CompositeKey} */
            isCompositeKey = function isKey(v) {
                return v !== null && typeof v === "object" && #id in v;
            }

            getKeyIdentity = (v) => v.#id;
        }

        static #root = new GCNode(null, null);

        /** @type {OpaqueId} */
        #id;

        constructor(...values) {
            this.#id = CompositeKey.#root.getId(values);
        }

        [SymbolKeyBy]() {
            return this;
        }

        get [Symbol.toStringTag]() {
            if (! (#id in this)) {
                throw new TypeError("receiver is not a CompositeKey");
            }
            return "CompositeKey";
        }

        static equal(a, b) {
            return a.#id === b.#id;
        }

        static of(...values) {
            return new CompositeKey(...values.map(trySymbol));
        }
    }

    /** @public */
    class MapPolyfill {
        #state = new OriginalMap();
        #keyBy;

        /**
         * @param {ReadonlyArray<ReadonlyArray<any>> | Iterable<ReadonlyArray<any>> | null} [values]
         * @param {{ keyBy?: ((k) => unknown) }} [config]
         */
        constructor(values, config) {
            const keyByConfig = config?.keyBy;
            if (keyByConfig === undefined) {
                this.#keyBy = (v) => v;
            } else {
                if (typeof keyByConfig !== "function") {
                    throw new TypeError(`keyBy must be a function`);
                }
                this.#keyBy = (v) => {
                    let k = keyByConfig(v);
                    if (isCompositeKey(k)) {
                        k = getKeyIdentity(k);
                    }
                    return k;
                };
            }

            if (values) {
                for (const [k, v] of values) {
                    this.set(k, v);
                }
            }
        }

        get size() {
            return this.#state.size;
        }

        clear() {
            return this.#state.clear();
        }

        get(k) {
            return this.#state.get(this.#keyBy(k))?.[1];
        }

        has(k) {
            return this.#state.has(this.#keyBy(k));
        }

        set(k, v) {
            this.#state.set(this.#keyBy(k), [k, v]);
            return this;
        }

        delete(k) {
            return this.#state.delete(k);
        }

        forEach(mapper, thisArg = undefined) {
            return this.#state.forEach((k, v) => mapper.call(thisArg, k, v, this));
        }

        *keys() {
            for (const [k] of this.#state.values()) {
                yield k;
            }
        }

        *values() {
            for (const [_k, v] of this.#state.values()) {
                yield v;
            }
        }

        *entries() {
            for (const [k, v] of this.#state.values()) {
                yield /** @type {[any, any]} */ ([k, v]);
            }
        }

        [Symbol.iterator]() {
            return this.entries();
        }

        get [Symbol.toStringTag]() {
            return "Map";
        }

        static get [Symbol.species]() {
            return this;
        }

        /**
         * @param {ReadonlyArray<ReadonlyArray<any>> | Iterable<ReadonlyArray<any>> | null} [values]
         */
        static usingKeys(values) {
            return new this(values, { keyBy: trySymbol });
        }
    }

    class SetPolyFill {
        #state;

        constructor(values, config) {
            this.#state = new MapPolyfill(values?.map(v => [v, v]), config);
        }

        get size() {
            return this.#state.size;
        }

        add(v) {
            this.#state.set(v, v);
            return this;
        }

        has(v) {
            return this.#state.has(v);
        }

        delete(v) {
            return this.#state.delete(v);
        }

        clear() {
            return this.#state.clear();
        }

        forEach(mapper, thisArg = undefined) {
            this.#state.forEach((_key, value) => mapper.call(value, this));
        }

        keys() {
            return this.#state.keys();
        }

        values() {
            return this.#state.keys();
        }

        entries() {
            return this.#state.entries();
        }

        [Symbol.iterator]() {
            return this.keys();
        }

        static get [Symbol.species]() {
            return this;
        }

        get [Symbol.toStringTag]() {
            return "Set";
        }

        /**
         * @param {ReadonlyArray<ReadonlyArray<any>> | Iterable<ReadonlyArray<any>> | null} [values]
         */
        static usingKeys(values) {
            return new this(values, { keyBy: trySymbol });
        }
    }

    /** @private */
    const RecordNamespace = Symbol();
    /** @private */
    const TupleNamespace = Symbol();

    /**
     * A comparison function to create a global ordering of symbols. The order is not observable, it is only used internally.
     * @private
     * @type {(s1: symbol, s2: symbol) => number}
     */
    const symbolOrder = run(() => {
        /** @typedef {Omit<MapLike<symbol, number>, "size">} SymbolNumberMap */

        const numberForSymbol = /** @type {SymbolNumberMap} */(
            symbolsAsWeakMapKeys ? new WeakMap() : new OriginalMap()
        );
        let nextNumber = 0;

        const getNumberForSymbol = (/** @type {symbol} */ s) => {
            let n = numberForSymbol.get(s);
            if (n === undefined) {
                n = nextNumber++;
                numberForSymbol.set(s, n);
            }
            return n;
        };

        return function compare(s1, s2) {
            const string1 = Symbol.keyFor(s1);
            const string2 = Symbol.keyFor(s2);
            if (string1 !== undefined) {
                if (string2 !== undefined) {
                    // both registered
                    return string1.localeCompare(string2);
                }
                // only s1 is registered
                return -1;
            }
            if (string2 !== undefined) {
                // only s2 is registered
                return +1;
            }
            // both unregistered
            return getNumberForSymbol(s1) - getNumberForSymbol(s2);
        }
    });

    /**
     * @param {string | symbol} k1
     * @param {string | symbol} k2
     * @returns {number}
     */
    function compareKeys(k1, k2) {
        if (typeof k1 === "symbol") {
            if (typeof k2 === "symbol") {
                // both symbols
                return symbolOrder(k1, k2);
            }
            // k1: symbol, k2: string
            return -1;
        }
        // k1: string
        if (typeof k2 === "symbol") {
            return +1;
        }
        // both strings
        return k1.localeCompare(k2);
    }

    function keyForRecord(r) {
        return new CompositeKey(
            RecordNamespace,
            ...Reflect.ownKeys(r)
                .filter(k => k !== SymbolKeyBy)
                .sort((k1, k2) => compareKeys(k1, k2))
                .flatMap((k) => {
                    let v = r[k];
                    v = trySymbol(v);
                    return [k, v];
                }),
        );
    }

    function keyForTuple(t) {
        return new CompositeKey(
            TupleNamespace,
            ...t.map(trySymbol),
        );
    }

    /** @public */
    function Record(obj) {
        let ck;
        const r = { ...obj };
        const overridesKeyBy = Object.getOwnPropertyDescriptor(r, SymbolKeyBy) !== undefined;
        if (!overridesKeyBy) {
            Object.defineProperty(r, SymbolKeyBy, {
                enumerable: false,
                value: () => ck ??= keyForRecord(r)
            });
        }
        Object.freeze(r);
        return r;
    }

    /** @public */
    function Tuple(...t) {
        let ck;
        Object.defineProperty(t, SymbolKeyBy, {
            enumerable: false,
            value: () => ck ??= keyForTuple(t)
        });
        Object.freeze(t);
        return t;
    }

    // exports:
    globalThis.CompositeKey = CompositeKey;
    globalThis.Map = MapPolyfill;
    globalThis.Set = SetPolyFill;
    globalThis.Record = Record;
    globalThis.Tuple = Tuple;
    Object.defineProperty(Symbol, "keyBy", {
        value: SymbolKeyBy,
    });
})();
