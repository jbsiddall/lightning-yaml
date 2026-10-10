include "JsNative.dfy"

module TextConsumer {
  import N = JsNative

  function Utf16Length(s: N.JsString): N.Index {
    N.StringLength(s)
  }

  function PrefixCodeUnits(s: N.JsString): N.JsString {
    N.StringConcat(N.StringSlice(s, 0, 1), N.StringSlice(s, 2, 3))
  }
}

module ArithmeticConsumer {
  import N = JsNative

  function Sum3(first: N.Number, second: N.Number, third: N.Number): N.Number {
    N.NumberAdd(N.NumberAdd(first, second), third)
  }
}

module Consumer {
  import N = JsNative

  method PushRead<A>(items: N.Array<A>, value: A, ghost heap: N.Heap<A>) returns (last: A)
    requires items in heap.arrays && |heap.arrays[items]| < 9007199254740991
    modifies heap
    ensures last == value
  {
    var length := N.ArrayLength(items, heap);
    N.ArrayPush(items, value, heap);
    last := N.ArrayGet(items, length, heap);
  }

  method Build(negativeZero: N.Number, nan: N.Number, positiveInfinity: N.Number,
               fractional: N.Number, large: N.Number) returns (result: N.Value) {
    ghost var heap := new N.Heap<N.Value>();
    var items := N.ArrayCreate<N.Value>(heap);
    N.ArrayPush(items, N.NumberValue(negativeZero), heap);
    N.ArrayPush(items, N.NumberValue(nan), heap);
    N.ArrayPush(items, N.NumberValue(positiveInfinity), heap);
    N.ArrayPush(items, N.NumberValue(fractional), heap);
    N.ArrayPush(items, N.NumberValue(large), heap);

    var itemsValue := N.ArrayValue(items);
    var cycle := PushRead(items, itemsValue, heap);

    var record := N.ObjectCreate<N.Value>(heap);
    N.ObjectSetSafe(record, "__proto__", N.NumberValue(fractional), heap);
    N.ObjectSetSafe(record, "items", itemsValue, heap);
    N.ObjectSetSafe(record, "alias", itemsValue, heap);
    N.ObjectSetSafe(record, "self", N.ObjectValue(record), heap);
    var projection := N.ObjectGet(record, "items", heap);
    var identity := N.SameValue(itemsValue, cycle) && N.SameValue(itemsValue, projection);
    N.ObjectSetSafe(record, "identity", N.BoolValue(identity), heap);

    result := N.ObjectValue(record);
  }
}
