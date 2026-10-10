module Native {
  newtype {:nativeType "number"} Index = x: int | 0 <= x < 9007199254740000
  newtype {:nativeType "number"} Counter = x: int | -9007199254740000 < x < 9007199254740000
  newtype {:nativeType "number"} Unit = x: int | 0 <= x < 65536

  type {:extern} Value
  type {:extern} Map
  type {:extern} Set
  // Native null sentinel used only to release optional retained Maps. Every
  // Map operation must follow a MapCreate or prove that the field is active.
  const {:extern "emptyMap"} EmptyMap: Map
  const {:extern "nullValue"} Null: Value
  const {:extern "undefinedValue"} Undefined: Value
  const {:extern "noDocumentValue"} NoDocument: Value
  const {:extern "notNumericValue"} NotNumeric: Value

  function {:extern "slice"} Slice(s: string, from: Index, to: Index): string
  function {:extern "parseNumber"} ParseNumber(s: string): Value
  function {:extern "parseSpecialNumber"} ParseSpecialNumber(s: string): Value
  function {:extern "stringValue"} StringValue(s: string): Value
  function {:extern "boolValue"} BoolValue(b: bool): Value
  function {:extern "numberValue"} NumberValue(n: Counter): Value
  function {:extern "numberAsCounter"} NumberAsCounter(value: Value): Counter
  function {:extern "numberMulAdd"} NumberMulAdd(accumulator: Value, radix: Counter, digit: Counter): Value
  function {:extern "numberNegate"} NumberNegate(value: Value): Value
  function {:extern "numberAdd"} NumberAdd(left: Value, right: Value): Value
  function {:extern "numberLessEqual"} NumberLessEqual(left: Value, right: Value): bool
  function {:extern "jsonQuote"} JsonQuote(text: string): string
  function {:extern "toString"} ToString(value: Value): string
  function {:extern "stringFallback"} StringFallback(value: Value): string
  function {:extern "stringLength"} StringLength(s: string): Index
  function {:extern "codeUnitAt"} CodeUnitAt(s: string, i: Index): Counter
  function {:extern "indexOf"} IndexOf(s: string, needle: string, from: Index): Counter
  function {:extern "concat"} Concat(a: string, b: string): string
  function {:extern "repeat"} Repeat(s: string, count: Index): string
  function {:extern "join"} Join(parts: Value, separator: string): string
  function {:extern "isNull"} IsNull(value: Value): bool
  function {:extern "isUndefined"} IsUndefined(value: Value): bool
  function {:extern "isObject"} IsObject(value: Value): bool
  function {:extern "isArray"} IsArray(value: Value): bool
  function {:extern "isMap"} IsMap(value: Value): bool
  function {:extern "isSet"} IsSet(value: Value): bool
  function {:extern "isUint8Array"} IsUint8Array(value: Value): bool
  function {:extern "isBoolean"} IsBoolean(value: Value): bool
  function {:extern "isNumber"} IsNumber(value: Value): bool
  function {:extern "isString"} IsString(value: Value): bool
  function {:extern "booleanValue"} BooleanValue(value: Value): bool
  function {:extern "numberIsNaN"} NumberIsNaN(value: Value): bool
  function {:extern "numberIsPositiveInfinity"} NumberIsPositiveInfinity(value: Value): bool
  function {:extern "numberIsNegativeInfinity"} NumberIsNegativeInfinity(value: Value): bool
  function {:extern "numberIsNegativeZero"} NumberIsNegativeZero(value: Value): bool
  function {:extern "formatNumber"} FormatNumber(value: Value): string
  function {:extern "stringValueOf"} StringValueOf(value: Value): string
  function {:extern "byteLength"} ByteLength(value: Value): Index
  function {:extern "byteGet"} ByteGet(value: Value, i: Index): Unit
  function {:extern "createUint8Array"} CreateUint8Array(length: Index): Value
  method {:extern "byteSet"} ByteSet(value: Value, i: Index, byte: Unit)
  function {:extern "stringFromCharCode"} StringFromCharCode(c: Unit): string
  function {:extern "stringFromCodePoint"} StringFromCodePoint(cp: Counter): string
  function {:extern "mapValue"} MapValue(m: Map): Value
  function {:extern "mapFromValue"} MapFromValue(value: Value): Map
  function {:extern "setValue"} SetValue(s: Set): Value
  function {:extern "sameValue"} SameValue(left: Value, right: Value): bool

  method {:extern "createArray"} CreateArray() returns (a: Value)
  method {:extern "arrayPush"} ArrayPush(a: Value, value: Value)
  method {:extern "arrayLength"} ArrayLength(a: Value) returns (n: Index)
  method {:extern "arrayGet"} ArrayGet(a: Value, i: Index) returns (value: Value)
  method {:extern "arraySet"} ArraySet(a: Value, i: Index, value: Value)
  method {:extern "createObject"} CreateObject() returns (o: Value)
  method {:extern "objectGet"} ObjectGet(o: Value, key: string) returns (value: Value)
  method {:extern "objectSet"} ObjectSet(o: Value, key: string, value: Value)
  method {:extern "objectSetSafe"} ObjectSetSafe(o: Value, key: string, value: Value)
  method {:extern "objectHasOwn"} ObjectHasOwn(o: Value, key: string) returns (present: bool)
  method {:extern "objectKeys"} ObjectKeys(o: Value) returns (keys: Value)
  method {:extern "mapCreate"} MapCreate() returns (m: Map)
  method {:extern "mapHas"} MapHas(m: Map, key: Value) returns (present: bool)
  method {:extern "mapGet"} MapGet(m: Map, key: Value) returns (value: Value)
  method {:extern "mapSet"} MapSet(m: Map, key: Value, value: Value)
  method {:extern "mapSize"} MapSize(m: Map) returns (size: Index)
  method {:extern "mapKeys"} MapKeys(value: Value) returns (keys: Value)
  method {:extern "setCreate"} SetCreate() returns (s: Set)
  method {:extern "setHas"} SetHas(s: Set, value: Value) returns (present: bool)
  method {:extern "setAdd"} SetAdd(s: Set, value: Value)
  method {:extern "setValues"} SetValues(value: Value) returns (values: Value)
  method {:extern "fail"} Fail(message: string)
}
