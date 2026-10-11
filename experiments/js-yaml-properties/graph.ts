export interface GraphComparison {
  equal: boolean;
  path?: string;
  reason?: string;
}

type EncodedValue =
  | null
  | boolean
  | string
  | number
  | { p: string; v?: string }
  | { r: number };
type EncodedNode = {
  kind: string;
  data?: unknown;
  props?: [string, EncodedValue][];
};
const fail = (message: string): never => {
  throw new TypeError(`Cannot encode graph: ${message}`);
};
const mismatch = (path: string, reason: string): GraphComparison => ({
  equal: false,
  path,
  reason,
});

function ownData(value: object, skipArrayIndices = false): [string, unknown][] {
  const properties: [string, unknown][] = [];
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") fail("symbol properties");
    const stringKey = String(key);
    if (skipArrayIndices && /^(0|[1-9]\d*)$/.test(stringKey)) continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, stringKey)!;
    if (!("value" in descriptor)) fail(`accessor property ${stringKey}`);
    if (descriptor.enumerable) properties.push([stringKey, descriptor.value]);
  }
  return properties;
}

function objectKind(value: object): string {
  if (Array.isArray(value))
    return Object.getPrototypeOf(value) === Array.prototype
      ? "array"
      : "unsupported";
  if (value instanceof Date)
    return Object.getPrototypeOf(value) === Date.prototype
      ? "date"
      : "unsupported";
  if (value instanceof RegExp)
    return Object.getPrototypeOf(value) === RegExp.prototype
      ? "regexp"
      : "unsupported";
  if (value instanceof Map)
    return Object.getPrototypeOf(value) === Map.prototype
      ? "map"
      : "unsupported";
  if (value instanceof Set)
    return Object.getPrototypeOf(value) === Set.prototype
      ? "set"
      : "unsupported";
  if (value instanceof DataView)
    return Object.getPrototypeOf(value) === DataView.prototype
      ? "dataview"
      : "unsupported";
  if (value instanceof ArrayBuffer)
    return Object.getPrototypeOf(value) === ArrayBuffer.prototype
      ? "arraybuffer"
      : "unsupported";
  if (Buffer.isBuffer(value))
    return Object.getPrototypeOf(value) === Buffer.prototype
      ? "node-buffer"
      : "unsupported";
  if (ArrayBuffer.isView(value)) {
    const prototypes = new Map<object, string>([
      [Int8Array.prototype, "Int8Array"],
      [Uint8Array.prototype, "Uint8Array"],
      [Uint8ClampedArray.prototype, "Uint8ClampedArray"],
      [Int16Array.prototype, "Int16Array"],
      [Uint16Array.prototype, "Uint16Array"],
      [Int32Array.prototype, "Int32Array"],
      [Uint32Array.prototype, "Uint32Array"],
      [Float32Array.prototype, "Float32Array"],
      [Float64Array.prototype, "Float64Array"],
      ...(typeof BigInt64Array === "undefined"
        ? []
        : [[BigInt64Array.prototype, "BigInt64Array"] as [object, string]]),
      ...(typeof BigUint64Array === "undefined"
        ? []
        : [[BigUint64Array.prototype, "BigUint64Array"] as [object, string]]),
    ]);
    return value instanceof DataView
      ? "unsupported"
      : `typed:${prototypes.get(Object.getPrototypeOf(value)) ?? "unsupported"}`;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === null
    ? "null-object"
    : prototype === Object.prototype
      ? "object"
      : "unsupported";
}

function visibleProps(value: object, kind: string): [string, unknown][] {
  return ownData(value, kind.startsWith("typed:") || kind === "node-buffer");
}

export function compareGraph(
  expected: unknown,
  actual: unknown,
): GraphComparison {
  const leftToRight = new Map<object, object>(),
    rightToLeft = new Map<object, object>();
  function visit(a: unknown, b: unknown, path: string): GraphComparison {
    const aObject = typeof a === "object" && a !== null;
    const bObject = typeof b === "object" && b !== null;
    if (!aObject || !bObject)
      return Object.is(a, b)
        ? { equal: true }
        : mismatch(path, "primitive values differ");
    const ao = a as object,
      bo = b as object;
    if (leftToRight.has(ao))
      return leftToRight.get(ao) === bo
        ? { equal: true }
        : mismatch(path, "shared reference does not match");
    if (rightToLeft.has(bo))
      return mismatch(path, "distinct references were merged");
    leftToRight.set(ao, bo);
    rightToLeft.set(bo, ao);
    const ka = objectKind(ao),
      kb = objectKind(bo);
    if (ka !== kb) return mismatch(path, `brands differ (${ka} vs ${kb})`);
    if (ka === "unsupported")
      return mismatch(path, "unsupported object prototype");
    if (
      ka === "date" &&
      !Object.is((ao as Date).getTime(), (bo as Date).getTime())
    )
      return mismatch(path, "dates differ");
    if (ka === "regexp") {
      const x = ao as RegExp,
        y = bo as RegExp;
      if (x.source !== y.source || x.flags !== y.flags)
        return mismatch(path, "regular expressions differ");
      const result = visit(x.lastIndex, y.lastIndex, `${path}.lastIndex`);
      if (!result.equal) return result;
    }
    if (ka === "map") {
      const x = [...(ao as Map<unknown, unknown>)],
        y = [...(bo as Map<unknown, unknown>)];
      if (x.length !== y.length) return mismatch(path, "map sizes differ");
      for (let i = 0; i < x.length; i++) {
        let result = visit(x[i]![0], y[i]![0], `${path}.<key:${i}>`);
        if (!result.equal) return result;
        result = visit(x[i]![1], y[i]![1], `${path}.<value:${i}>`);
        if (!result.equal) return result;
      }
    } else if (ka === "set") {
      const x = [...(ao as Set<unknown>)],
        y = [...(bo as Set<unknown>)];
      if (x.length !== y.length) return mismatch(path, "set sizes differ");
      for (let i = 0; i < x.length; i++) {
        const result = visit(x[i], y[i], `${path}.<set:${i}>`);
        if (!result.equal) return result;
      }
    } else if (ka === "node-buffer") {
      const x = ao as Buffer,
        y = bo as Buffer;
      if (x.length !== y.length || x.some((byte, index) => byte !== y[index]))
        return mismatch(path, "Buffer bytes differ");
    } else if (ka === "arraybuffer") {
      const x = new Uint8Array(ao as ArrayBuffer),
        y = new Uint8Array(bo as ArrayBuffer);
      if (x.length !== y.length || x.some((byte, i) => byte !== y[i]))
        return mismatch(path, "binary bytes differ");
    } else if (ka === "dataview" || ka.startsWith("typed:")) {
      const x = ao as ArrayBufferView,
        y = bo as ArrayBufferView;
      if (
        x.byteOffset !== y.byteOffset ||
        x.byteLength !== y.byteLength ||
        (ka.startsWith("typed:") &&
          (x as unknown as { length: number }).length !==
            (y as unknown as { length: number }).length)
      )
        return mismatch(path, "view metadata differs");
      const result = visit(x.buffer, y.buffer, `${path}.buffer`);
      if (!result.equal) return result;
    }
    const ax = visibleProps(ao, ka),
      bx = visibleProps(bo, kb),
      bm = new Map(bx);
    if (ax.length !== bx.length)
      return mismatch(path, "own property counts differ");
    for (const [key, value] of ax) {
      if (!bm.has(key))
        return mismatch(`${path}.${key}`, "property is missing");
      const result = visit(value, bm.get(key), `${path}.${key}`);
      if (!result.equal) return result;
    }
    if (ka === "array" && (ao as unknown[]).length !== (bo as unknown[]).length)
      return mismatch(`${path}.length`, "array lengths differ");
    return { equal: true };
  }
  return visit(expected, actual, "$");
}

function primitive(value: unknown): EncodedValue | undefined {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return value;
  if (typeof value === "number")
    return Number.isFinite(value) && !Object.is(value, -0)
      ? value
      : { p: "number", v: String(value) };
  if (typeof value === "undefined") return { p: "undefined" };
  if (typeof value === "bigint") return { p: "bigint", v: String(value) };
  if (typeof value === "symbol" || typeof value === "function")
    fail(typeof value);
  return undefined;
}

export function encodeGraph(value: unknown): string {
  const ids = new Map<object, number>(),
    nodes: EncodedNode[] = [];
  function ref(input: unknown): EncodedValue {
    const encodedPrimitive = primitive(input);
    if (encodedPrimitive !== undefined) return encodedPrimitive;
    const object = input as object,
      known = ids.get(object);
    if (known !== undefined) return { r: known };
    const kind = objectKind(object);
    if (kind === "typed:unsupported")
      fail("unsupported typed array brand or subclass");
    if (kind === "unsupported") fail("opaque objects and subclasses");
    const id = nodes.length;
    ids.set(object, id);
    nodes.push({ kind: "pending" });
    const props = visibleProps(object, kind).map(
      ([key, prop]) => [key, ref(prop)] as [string, EncodedValue],
    );
    let data: unknown;
    if (kind === "array") data = (object as unknown[]).length;
    else if (kind === "date")
      data = Number.isNaN((object as Date).getTime())
        ? "NaN"
        : (object as Date).getTime();
    else if (kind === "regexp") {
      const re = object as RegExp;
      data = [re.source, re.flags, ref(re.lastIndex)];
    } else if (kind === "map")
      data = [...(object as Map<unknown, unknown>)].map(([key, item]) => [
        ref(key),
        ref(item),
      ]);
    else if (kind === "set") data = [...(object as Set<unknown>)].map(ref);
    // Buffer pools contain unrelated allocations; only the visible bytes belong to this value.
    else if (kind === "node-buffer") data = [...(object as Buffer)];
    else if (kind === "arraybuffer")
      data = [...new Uint8Array(object as ArrayBuffer)];
    else if (kind === "dataview" || kind.startsWith("typed:")) {
      const view = object as ArrayBufferView;
      data = {
        buffer: ref(view.buffer),
        byteOffset: view.byteOffset,
        byteLength: view.byteLength,
        ...(kind.startsWith("typed:")
          ? { length: (view as unknown as { length: number }).length }
          : {}),
      };
    }
    nodes[id] = {
      kind,
      ...(data === undefined ? {} : { data }),
      ...(props.length ? { props } : {}),
    };
    return { r: id };
  }
  return JSON.stringify({ version: 1, root: ref(value), nodes });
}

function invalid(): never {
  throw new TypeError("Invalid graph encoding");
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function decodeGraph(encoded: string): unknown {
  let payload: unknown;
  try {
    payload = JSON.parse(encoded);
  } catch {
    return invalid();
  }
  if (
    !record(payload) ||
    payload.version !== 1 ||
    !Array.isArray(payload.nodes) ||
    !Object.hasOwn(payload, "root")
  )
    return invalid();
  const nodes = payload.nodes as unknown[];
  const isRef = (v: unknown): v is { r: number } =>
    record(v) &&
    Object.keys(v).length === 1 &&
    Number.isInteger(v.r) &&
    (v.r as number) >= 0 &&
    (v.r as number) < nodes.length;
  const isPrimitive = (v: unknown): v is EncodedValue => {
    if (v === null || typeof v === "boolean" || typeof v === "string")
      return true;
    if (typeof v === "number") return Number.isFinite(v) && !Object.is(v, -0);
    if (isRef(v)) return true;
    if (!record(v) || typeof v.p !== "string") return false;
    if (v.p === "undefined") return Object.keys(v).length === 1;
    if (Object.keys(v).length !== 2 || typeof v.v !== "string") return false;
    if (v.p === "bigint") return /^-?(0|[1-9]\d*)$/.test(v.v);
    return (
      v.p === "number" &&
      ["NaN", "Infinity", "-Infinity", "0", "-0"].includes(v.v)
    );
  };
  if (!isPrimitive(payload.root)) return invalid();
  const validProps = (props: unknown): props is [string, EncodedValue][] =>
    props === undefined ||
    (Array.isArray(props) &&
      props.every(
        (pair) =>
          Array.isArray(pair) &&
          pair.length === 2 &&
          typeof pair[0] === "string" &&
          isPrimitive(pair[1]),
      ));
  const validBytes = (data: unknown): data is number[] =>
    Array.isArray(data) &&
    data.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255);
  for (const raw of nodes) {
    if (!record(raw) || typeof raw.kind !== "string" || !validProps(raw.props))
      return invalid();
    if (
      Object.keys(raw).some((key) => !["kind", "data", "props"].includes(key))
    )
      return invalid();
    if (
      raw.props &&
      new Set(raw.props.map((pair) => pair[0])).size !== raw.props.length
    )
      return invalid();
    if (raw.props?.some((pair) => pair[0] === "length" && raw.kind === "array"))
      return invalid();
    if (
      (raw.kind.startsWith("typed:") || raw.kind === "node-buffer") &&
      raw.props?.some((pair) => /^(0|[1-9]\d*)$/.test(pair[0]))
    )
      return invalid();
    switch (raw.kind) {
      case "object":
      case "null-object":
        if (raw.data !== undefined) return invalid();
        break;
      case "map":
      case "set":
        if (!Object.hasOwn(raw, "data")) return invalid();
        break;
      case "array":
        if (
          !Number.isSafeInteger(raw.data) ||
          (raw.data as number) < 0 ||
          (raw.data as number) > 0xffff_ffff
        )
          return invalid();
        if (
          raw.props?.some(
            ([key]) =>
              /^(0|[1-9]\d*)$/.test(key) &&
              Number(key) <= 0xffff_fffe &&
              Number(key) >= (raw.data as number),
          )
        )
          return invalid();
        break;
      case "date":
        if (
          !(
            raw.data === "NaN" ||
            (typeof raw.data === "number" &&
              Number.isSafeInteger(raw.data) &&
              Math.abs(raw.data) <= 8_640_000_000_000_000)
          )
        )
          return invalid();
        break;
      case "regexp":
        if (
          !Array.isArray(raw.data) ||
          raw.data.length !== 3 ||
          typeof raw.data[0] !== "string" ||
          typeof raw.data[1] !== "string" ||
          !isPrimitive(raw.data[2])
        )
          return invalid();
        try {
          new RegExp(raw.data[0], raw.data[1]);
        } catch {
          return invalid();
        }
        break;
      case "node-buffer":
      case "arraybuffer":
        if (!validBytes(raw.data)) return invalid();
        break;
      case "map":
        if (
          raw.data !== undefined &&
          (!Array.isArray(raw.data) ||
            raw.data.some(
              (entry) =>
                !Array.isArray(entry) ||
                entry.length !== 2 ||
                !isPrimitive(entry[0]) ||
                !isPrimitive(entry[1]),
            ))
        )
          return invalid();
        break;
      case "set":
        if (
          raw.data !== undefined &&
          (!Array.isArray(raw.data) ||
            raw.data.some((item) => !isPrimitive(item)))
        )
          return invalid();
        break;
      case "dataview":
      case "typed:Int8Array":
      case "typed:Uint8Array":
      case "typed:Uint8ClampedArray":
      case "typed:Int16Array":
      case "typed:Uint16Array":
      case "typed:Int32Array":
      case "typed:Uint32Array":
      case "typed:Float32Array":
      case "typed:Float64Array":
      case "typed:BigInt64Array":
      case "typed:BigUint64Array":
        if (
          !record(raw.data) ||
          !isRef(raw.data.buffer) ||
          !Number.isSafeInteger(raw.data.byteOffset) ||
          (raw.data.byteOffset as number) < 0 ||
          !Number.isSafeInteger(raw.data.byteLength) ||
          (raw.data.byteLength as number) < 0
        )
          return invalid();
        if (
          raw.kind !== "dataview" &&
          (!Number.isSafeInteger(raw.data.length) ||
            (raw.data.length as number) < 0)
        )
          return invalid();
        break;
      default:
        return invalid();
    }
  }
  const values: unknown[] = nodes.map((raw) => {
    const node = raw as Record<string, unknown>;
    switch (node.kind) {
      case "array":
        return new Array(node.data as number);
      case "object":
        return {};
      case "null-object":
        return Object.create(null) as object;
      case "date":
        return new Date(node.data === "NaN" ? NaN : (node.data as number));
      case "regexp": {
        const [source, flags] = node.data as [string, string, EncodedValue];
        return new RegExp(source, flags);
      }
      case "map":
        return new Map();
      case "set":
        return new Set();
      case "node-buffer":
        return Buffer.from(node.data as number[]);
      case "arraybuffer":
        return new Uint8Array(node.data as number[]).buffer;
      default:
        return Object.create(null) as object;
    }
  });
  function val(encodedValue: unknown): unknown {
    if (isRef(encodedValue)) return values[encodedValue.r];
    if (encodedValue === null || typeof encodedValue !== "object")
      return encodedValue;
    const token = encodedValue as { p: string; v?: string };
    if (token.p === "undefined") return undefined;
    if (token.p === "bigint") return BigInt(token.v!);
    if (token.p === "number") {
      switch (token.v) {
        case "NaN":
          return NaN;
        case "Infinity":
          return Infinity;
        case "-Infinity":
          return -Infinity;
        case "0":
          return 0;
        case "-0":
          return -0;
        default:
          return invalid();
      }
    }
    return invalid();
  }
  nodes.forEach((raw, i) => {
    const node = raw as Record<string, unknown>;
    if (node.kind !== "dataview" && !String(node.kind).startsWith("typed:"))
      return;
    const info = node.data as {
      buffer: { r: number };
      byteOffset: number;
      byteLength: number;
      length?: number;
    };
    const buffer = values[info.buffer.r] as ArrayBuffer;
    if (
      !(buffer instanceof ArrayBuffer) ||
      info.byteOffset + info.byteLength > buffer.byteLength
    )
      return invalid();
    let view: object;
    if (node.kind === "dataview")
      view = new DataView(buffer, info.byteOffset, info.byteLength);
    else {
      const constructors: Record<
        string,
        (b: ArrayBuffer, o: number, n: number) => object
      > = {
        "typed:Int8Array": (b, o, n) => new Int8Array(b, o, n),
        "typed:Uint8Array": (b, o, n) => new Uint8Array(b, o, n),
        "typed:Uint8ClampedArray": (b, o, n) => new Uint8ClampedArray(b, o, n),
        "typed:Int16Array": (b, o, n) => new Int16Array(b, o, n),
        "typed:Uint16Array": (b, o, n) => new Uint16Array(b, o, n),
        "typed:Int32Array": (b, o, n) => new Int32Array(b, o, n),
        "typed:Uint32Array": (b, o, n) => new Uint32Array(b, o, n),
        "typed:Float32Array": (b, o, n) => new Float32Array(b, o, n),
        "typed:Float64Array": (b, o, n) => new Float64Array(b, o, n),
        "typed:BigInt64Array": (b, o, n) => new BigInt64Array(b, o, n),
        "typed:BigUint64Array": (b, o, n) => new BigUint64Array(b, o, n),
      };
      const create = constructors[node.kind as string];
      if (!create) return invalid();
      const elementSize = (
        {
          "typed:Int8Array": 1,
          "typed:Uint8Array": 1,
          "typed:Uint8ClampedArray": 1,
          "typed:Int16Array": 2,
          "typed:Uint16Array": 2,
          "typed:Int32Array": 4,
          "typed:Uint32Array": 4,
          "typed:Float32Array": 4,
          "typed:Float64Array": 8,
          "typed:BigInt64Array": 8,
          "typed:BigUint64Array": 8,
        } as Record<string, number>
      )[node.kind as string]!;
      if (
        info.byteOffset % elementSize ||
        info.byteLength !== (info.length ?? -1) * elementSize
      )
        return invalid();
      view = create(buffer, info.byteOffset, info.length!);
    }
    values[i] = view;
  });
  nodes.forEach((raw, i) => {
    const node = raw as Record<string, unknown>,
      target = values[i] as object;
    if (node.kind === "regexp")
      Object.defineProperty(target, "lastIndex", {
        value: val((node.data as [string, string, EncodedValue])[2]),
        writable: true,
        configurable: false,
      });
    if (node.kind === "map")
      for (const [key, item] of node.data as [EncodedValue, EncodedValue][])
        (target as Map<unknown, unknown>).set(val(key), val(item));
    if (node.kind === "set")
      for (const item of node.data as EncodedValue[])
        (target as Set<unknown>).add(val(item));
    for (const [key, item] of (node.props ?? []) as [string, EncodedValue][])
      Object.defineProperty(target, key, {
        value: val(item),
        enumerable: true,
        writable: true,
        configurable: true,
      });
  });
  return val(payload.root);
}
