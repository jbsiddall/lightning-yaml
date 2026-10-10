include "JsNative.dfy"

module UnsupportedInjection {
  import N = JsNative

  method Main() {
    ghost var heap := new N.Heap<int>();
    var values := N.ArrayCreate<int>(heap);
    N.ArrayPush(values, 42, heap);
    var invalid := N.ArrayValue(values);
  }
}
