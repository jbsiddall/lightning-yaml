// Native ABI contracts are trusted; JavaScript tests validate the host implementation.
module NativeValues {
  newtype {:nativeType "number"} Index = x: int | 0 <= x < 2147483647
  type {:extern} Value
  const {:extern "nullValue"} Null: Value
  const {:extern "undefinedValue"} Undefined: Value

  class {:extern} Heap {
    ghost var arrays: map<Value, seq<Value>>
    ghost var objects: map<Value, map<string, Value>>
    ghost var numbers: set<Value>
    ghost var integers: map<Value, int>
    ghost var booleans: map<Value, bool>
    ghost var strings: map<Value, string>

    ghost predicate Known(v: Value) reads this {
      v == Null || v == Undefined || v in arrays || v in objects ||
      v in numbers || v in booleans || v in strings
    }

    ghost predicate Valid() reads this {
      Null != Undefined && Null !in arrays && Undefined !in arrays &&
      Null !in objects && Undefined !in objects &&
      arrays.Keys !! objects.Keys &&
      arrays.Keys !! numbers && objects.Keys !! numbers &&
      arrays.Keys !! booleans.Keys && objects.Keys !! booleans.Keys &&
      arrays.Keys !! strings.Keys && objects.Keys !! strings.Keys &&
      numbers !! booleans.Keys && numbers !! strings.Keys && booleans.Keys !! strings.Keys &&
      Null !in numbers && Undefined !in numbers &&
      Null !in booleans && Undefined !in booleans &&
      Null !in strings && Undefined !in strings &&
      integers.Keys <= numbers &&
      (forall a | a in arrays :: |arrays[a]| < 2147483647) &&
      (forall a | a in arrays :: forall v | v in arrays[a] :: Known(v)) &&
      (forall o | o in objects :: forall k | k in objects[o] :: Known(objects[o][k]))
    }
  }

  method {:extern "createHeap"} NewHeap() returns (h: Heap)
    ensures fresh(h) && h.Valid()
    ensures h.arrays == map[] && h.objects == map[]
    ensures h.numbers == {} && h.integers == map[] && h.booleans == map[] && h.strings == map[]

  method {:extern "numberFromIndex"} NumberFromIndex(h: Heap, n: Index) returns (v: Value)
    requires h.Valid()
    modifies h
    ensures h.Valid() && h.Known(v)
    ensures h.integers == old(h.integers)[v := n as int]
    ensures forall x | x in old(h.integers) :: h.integers[x] == old(h.integers)[x]
    ensures h.numbers == old(h.numbers) + {v}
    ensures h.arrays == old(h.arrays) && h.objects == old(h.objects)
    ensures h.booleans == old(h.booleans) && h.strings == old(h.strings)

  // These preserve JS Number/String semantics; no mathematical-real proof is claimed.
  method {:extern "parseNumber"} ParseNumber(h: Heap, text: string) returns (v: Value)
    requires h.Valid()
    modifies h
    ensures h.Valid() && v in h.numbers
    ensures h.numbers == old(h.numbers) + {v}
    ensures h.integers == old(h.integers) && h.booleans == old(h.booleans) && h.strings == old(h.strings)
    ensures h.arrays == old(h.arrays) && h.objects == old(h.objects)

  method {:extern "stringifyNumber"} StringifyNumber(h: Heap, v: Value) returns (text: string)
    requires h.Valid() && v in h.numbers

  method {:extern "boolValue"} BoolValue(h: Heap, b: bool) returns (v: Value)
    requires h.Valid()
    modifies h
    ensures h.Valid() && h.booleans == old(h.booleans)[v := b]
    ensures forall x | x in old(h.booleans) :: h.booleans[x] == old(h.booleans)[x]
    ensures h.arrays == old(h.arrays) && h.objects == old(h.objects)
    ensures h.numbers == old(h.numbers) && h.integers == old(h.integers) && h.strings == old(h.strings)

  method {:extern "stringValue"} StringValue(h: Heap, text: string) returns (v: Value)
    requires h.Valid()
    modifies h
    ensures h.Valid() && h.strings == old(h.strings)[v := text]
    ensures forall x | x in old(h.strings) :: h.strings[x] == old(h.strings)[x]
    ensures h.arrays == old(h.arrays) && h.objects == old(h.objects)
    ensures h.numbers == old(h.numbers) && h.integers == old(h.integers) && h.booleans == old(h.booleans)

  method {:extern "isNull"} IsNull(h: Heap, v: Value) returns (b: bool)
    requires h.Valid()
    ensures b == (v == Null)

  method {:extern "isUndefined"} IsUndefined(h: Heap, v: Value) returns (b: bool)
    requires h.Valid()
    ensures b == (v == Undefined)

  method {:extern "sameValue"} SameValue(h: Heap, a: Value, b: Value) returns (same: bool)
    requires h.Valid()
    ensures same == (a == b)

  method {:extern "createArray"} CreateArray(h: Heap) returns (a: Value)
    requires h.Valid()
    modifies h
    ensures h.Valid() && a != Null && a != Undefined
    ensures a !in old(h.arrays) && a !in old(h.objects) && a !in old(h.numbers)
    ensures a !in old(h.booleans) && a !in old(h.strings)
    ensures h.arrays == old(h.arrays)[a := []]
    ensures h.objects == old(h.objects) && h.numbers == old(h.numbers) && h.integers == old(h.integers)
    ensures h.booleans == old(h.booleans) && h.strings == old(h.strings)

  method {:extern "arrayPush"} ArrayPush(h: Heap, a: Value, v: Value)
    requires h.Valid() && a in h.arrays && h.Known(v)
    requires |h.arrays[a]| < 2147483646
    modifies h
    ensures h.Valid() && h.arrays == old(h.arrays)[a := old(h.arrays[a]) + [v]]
    ensures h.objects == old(h.objects) && h.numbers == old(h.numbers) && h.integers == old(h.integers)
    ensures h.booleans == old(h.booleans) && h.strings == old(h.strings)

  method {:extern "arrayGet"} ArrayGet(h: Heap, a: Value, i: Index) returns (v: Value)
    requires h.Valid() && a in h.arrays && (i as int) < |h.arrays[a]|
    ensures v == h.arrays[a][i]

  method {:extern "arraySet"} ArraySet(h: Heap, a: Value, i: Index, v: Value)
    requires h.Valid() && a in h.arrays && (i as int) < |h.arrays[a]| && h.Known(v)
    modifies h
    ensures h.Valid() && h.arrays == old(h.arrays)[a := old(h.arrays[a])[i := v]]
    ensures h.objects == old(h.objects) && h.numbers == old(h.numbers) && h.integers == old(h.integers)
    ensures h.booleans == old(h.booleans) && h.strings == old(h.strings)

  method {:extern "arrayLength"} ArrayLength(h: Heap, a: Value) returns (n: Index)
    requires h.Valid() && a in h.arrays
    ensures n as int == |h.arrays[a]|

  method {:extern "createObject"} CreateObject(h: Heap) returns (o: Value)
    requires h.Valid()
    modifies h
    ensures h.Valid() && o != Null && o != Undefined
    ensures o !in old(h.arrays) && o !in old(h.objects) && o !in old(h.numbers)
    ensures o !in old(h.booleans) && o !in old(h.strings)
    ensures h.objects == old(h.objects)[o := map[]]
    ensures h.arrays == old(h.arrays) && h.numbers == old(h.numbers) && h.integers == old(h.integers)
    ensures h.booleans == old(h.booleans) && h.strings == old(h.strings)

  method {:extern "objectSet"} ObjectSet(h: Heap, o: Value, key: string, v: Value)
    requires h.Valid() && o in h.objects && h.Known(v)
    modifies h
    ensures h.Valid() && h.objects == old(h.objects)[o := old(h.objects[o])[key := v]]
    ensures h.arrays == old(h.arrays) && h.numbers == old(h.numbers) && h.integers == old(h.integers)
    ensures h.booleans == old(h.booleans) && h.strings == old(h.strings)

  method {:extern "objectGet"} ObjectGet(h: Heap, o: Value, key: string) returns (v: Value)
    requires h.Valid() && o in h.objects
    ensures v == (if key in h.objects[o] then h.objects[o][key] else Undefined)

  method {:extern "objectHasOwn"} ObjectHasOwn(h: Heap, o: Value, key: string) returns (present: bool)
    requires h.Valid() && o in h.objects
    ensures present == (key in h.objects[o])

  // Key order is deliberately unspecified; JS enumeration order needs a richer model.
  method {:extern "objectKeys"} ObjectKeys(h: Heap, o: Value) returns (a: Value)
    requires h.Valid() && o in h.objects && |h.objects[o]| < 2147483647
    modifies h
    ensures h.Valid() && a in h.arrays
    ensures a !in old(h.arrays) && a !in old(h.objects) && a !in old(h.numbers)
    ensures a !in old(h.booleans) && a !in old(h.strings) && a != Null && a != Undefined
    ensures h.arrays == old(h.arrays)[a := h.arrays[a]]
    ensures h.objects == old(h.objects) && h.numbers == old(h.numbers) && h.integers == old(h.integers)
    ensures h.booleans == old(h.booleans)
    ensures old(h.strings.Keys) <= h.strings.Keys
    ensures forall x | x in old(h.strings) :: h.strings[x] == old(h.strings)[x]
    ensures |h.arrays[a]| == |h.objects[o]|
    ensures forall i: int | 0 <= i < |h.arrays[a]| :: h.arrays[a][i] in h.strings
    ensures (set i: int | 0 <= i < |h.arrays[a]| :: h.strings[h.arrays[a][i]]) == h.objects[o].Keys

  method ObjectKeyCount(h: Heap, o: Value) returns (count: Index)
    requires h.Valid() && o in h.objects && |h.objects[o]| < 2147483647
    modifies h
    ensures h.Valid() && h.objects == old(h.objects)
    ensures count as int == |h.objects[o]|
  {
    var keys := ObjectKeys(h, o);
    count := ArrayLength(h, keys);
  }

  method Demo(h: Heap) returns (root: Value)
    requires h.Valid()
    modifies h
    ensures h.Valid() && root in h.objects
    ensures "self" in h.objects[root] && h.objects[root]["self"] == root
    ensures "null" in h.objects[root] && h.objects[root]["null"] == Null
    ensures "undefined" in h.objects[root] && h.objects[root]["undefined"] == Undefined
    ensures "list" in h.objects[root] && h.objects[root]["list"] in h.arrays
    ensures |h.arrays[h.objects[root]["list"]]| == 2
    ensures "child" in h.objects[root] && h.objects[root]["child"] in h.objects
    ensures h.arrays[h.objects[root]["list"]][0] == h.objects[root]["child"]
    ensures h.arrays[h.objects[root]["list"]][1] == h.objects[root]["child"]
    ensures "number" in h.objects[h.objects[root]["child"]]
    ensures h.objects[h.objects[root]["child"]]["number"] in h.integers
    ensures h.integers[h.objects[h.objects[root]["child"]]["number"]] == 7
    ensures "text" in h.objects[h.objects[root]["child"]]
    ensures h.objects[h.objects[root]["child"]]["text"] in h.strings
    ensures h.strings[h.objects[h.objects[root]["child"]]["text"]] == "native text"
    ensures "boolean" in h.objects[h.objects[root]["child"]]
    ensures h.objects[h.objects[root]["child"]]["boolean"] in h.booleans
    ensures h.booleans[h.objects[h.objects[root]["child"]]["boolean"]]
  {
    var child := CreateObject(h);
    var number := NumberFromIndex(h, 7);
    ObjectSet(h, child, "number", number);
    var text := StringValue(h, "native text");
    ObjectSet(h, child, "text", text);
    var truth := BoolValue(h, true);
    ObjectSet(h, child, "boolean", truth);
    var list := CreateArray(h);
    ArrayPush(h, list, child);
    ArrayPush(h, list, child);
    root := CreateObject(h);
    ObjectSet(h, root, "child", child);
    ObjectSet(h, root, "list", list);
    ObjectSet(h, root, "null", Null);
    ObjectSet(h, root, "undefined", Undefined);
    ObjectSet(h, root, "self", root);
    var readChild := ObjectGet(h, root, "child");
    var first := ArrayGet(h, list, 0);
    var same := SameValue(h, readChild, first);
    assert same;
    var n := IsNull(h, Null);
    var u := IsUndefined(h, Undefined);
    assert n && u;
  }

  method BuildNumbers(h: Heap, count: Index) returns (list: Value)
    requires h.Valid()
    modifies h
    ensures h.Valid() && list in h.arrays
    ensures |h.arrays[list]| == count as int
    ensures forall j: int | 0 <= j < count as int :: h.arrays[list][j] in h.integers && h.integers[h.arrays[list][j]] == j
  {
    list := CreateArray(h);
    var i: Index := 0;
    while i < count
      invariant h.Valid() && list in h.arrays
      invariant 0 <= i <= count && |h.arrays[list]| == i as int
      invariant forall j: int | 0 <= j < i as int :: h.arrays[list][j] in h.integers && h.integers[h.arrays[list][j]] == j
    {
      var number := NumberFromIndex(h, i);
      ArrayPush(h, list, number);
      i := i + 1;
    }
  }
}
