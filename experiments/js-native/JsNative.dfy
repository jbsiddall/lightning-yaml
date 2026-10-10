module {:extern "JsNative", "./js-native.cjs"} JsNative {
  newtype {:compile false} {:nativeType "number"} Index = i: int | 0 <= i < 9007199254740992
  type {:extern} Value
  type {:extern} Number
  type {:extern} JsString
  type {:extern} Array<A>
  type {:extern} Object<A>

  class {:compile false} Heap<A> {
    ghost var arrays: map<Array<A>, seq<A>>
    ghost var objects: map<Object<A>, map<string, A>>

    ghost constructor () {
      arrays := map[];
      objects := map[];
    }
  }

  method {:extern "arrayCreate"} {:axiom} ArrayCreate<A>(ghost h: Heap<A>) returns (a: Array<A>)
    modifies h
    ensures a !in old(h.arrays)
    ensures h.arrays == old(h.arrays)[a := []]
    ensures h.objects == old(h.objects)

  method {:extern "arrayGet"} {:axiom} ArrayGet<A>(a: Array<A>, i: Index, ghost h: Heap<A>) returns (value: A)
    requires a in h.arrays && (i as int) < |h.arrays[a]|
    ensures value == h.arrays[a][i as int]

  method {:extern "arrayLength"} {:axiom} ArrayLength<A>(a: Array<A>, ghost h: Heap<A>) returns (length: Index)
    requires a in h.arrays && |h.arrays[a]| < 9007199254740992
    ensures (length as int) == |h.arrays[a]|

  method {:extern "arrayPush"} {:axiom} ArrayPush<A>(a: Array<A>, value: A, ghost h: Heap<A>)
    requires a in h.arrays
    modifies h
    ensures h.arrays == old(h.arrays)[a := old(h.arrays[a]) + [value]]
    ensures h.objects == old(h.objects)

  method {:extern "objectCreate"} {:axiom} ObjectCreate<A>(ghost h: Heap<A>) returns (o: Object<A>)
    modifies h
    ensures o !in old(h.objects)
    ensures h.objects == old(h.objects)[o := map[]]
    ensures h.arrays == old(h.arrays)

  method {:extern "objectSetSafe"} {:axiom} ObjectSetSafe<A>(o: Object<A>, key: string, value: A, ghost h: Heap<A>)
    requires o in h.objects
    modifies h
    ensures h.objects == old(h.objects)[o := old(h.objects[o])[key := value]]
    ensures h.arrays == old(h.arrays)

  method {:extern "objectGet"} {:axiom} ObjectGet<A>(o: Object<A>, key: string, ghost h: Heap<A>) returns (value: A)
    requires o in h.objects && key in h.objects[o]
    ensures value == h.objects[o][key]

  function {:extern "arrayValue"} ArrayValue(a: Array<Value>): Value
  function {:extern "objectValue"} ObjectValue(o: Object<Value>): Value
  function {:extern "stringLength"} StringLength(s: JsString): Index
  function {:extern "stringSlice"} StringSlice(s: JsString, from: Index, to: Index): JsString
  function {:extern "stringConcat"} StringConcat(left: JsString, right: JsString): JsString
  function {:extern "numberValue"} NumberValue(n: Number): Value
  function {:extern "numberAdd"} NumberAdd(left: Number, right: Number): Number
  function {:extern "boolValue"} BoolValue(b: bool): Value
  function {:extern "sameValue"} SameValue(left: Value, right: Value): bool
}
