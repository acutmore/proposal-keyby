// @ts-check
/// <reference lib="es2022" />

(function () {
    const { Map: OriginalMap } = globalThis;

    let symbolsAsWeakMapKeys = false;
    try {
        // @ts-expect-error
        new WeakSet([Symbol()]);
        symbolsAsWeakMapKeys = true;
    } catch {}


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
        static #transitionMarker = symbolsAsWeakMapKeys ? Symbol("<transition>") : {"<transition>": true};

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
            head = CompositeKey.isKey(head)
                ? CompositeKey["__keyId"](head)
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

    /** @public */
    class CompositeKey {
        static {
            globalThis.CompositeKey = CompositeKey;
        }

        static #root = new GCNode(null, null);

        /** @type {OpaqueId} */
        #id;

        constructor(values = []) {
            this.#id = CompositeKey.#root.getId(values);
        }

        [SymbolKeyBy]() {
            return this;
        }

        static isKey(v) {
            return typeof v === "object" && v !== null && #id in v;
        }

        static equal(a, b) {
            return a.#id === b.#id;
        }

        static of(...values) {
            return new CompositeKey(values.map(trySymbol));
        }

        /** @private */
        static __keyId(v) {
            return v.#id;
        }
    }

    /** @public */
    class CustomKeyMap {
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
                    if (CompositeKey.isKey(k)) {
                        k = CompositeKey["__keyId"](k);
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
            return this.#state.forEach(mapper, thisArg);
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
            return Map;
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

    function keyForRecord(r) {
        return new CompositeKey([
            RecordNamespace,
            ...Object.entries(r)
                .sort(([k1], [k2]) => k1.localeCompare(k2)) // TODO symbol keys?
                .flatMap(([k, v]) => {
                    v = trySymbol(v);
                    return [k, v];
                }),
        ]);
    }

    /** @public */
    function Record(obj) {
        let ck;
        const r = { ...obj };
        Object.defineProperty(r, SymbolKeyBy, {
            enumerable: false,
            value: () => ck ??= keyForRecord(r)
        });
        Object.freeze(r);
        return r;
    }

    // exports:
    globalThis.CompositeKey = CompositeKey;
    globalThis.Map = CustomKeyMap;
    globalThis.Record = Record;
    Object.defineProperty(Symbol, "keyBy", {
        value: SymbolKeyBy,
    });
})();
