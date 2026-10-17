module Raw {
  newtype {:nativeType "number"} Count = x: int | 0 <= x < 2147483647
  type {:extern} Any(==)

  method {:extern "number"} Number(value: Count) returns (v: Any)
  method {:extern "array"} Array(a: Any, b: Any) returns (v: Any)

  method Make() returns (v: Any) {
    var a := Number(7);
    v := Array(a, a);
  }

  method Identity(v: Any) returns (r: Any)
    ensures r == v
  {
    r := v;
  }

  method BuiltinEquality(a: Any, b: Any) returns (same: bool)
    ensures same == (a == b)
  {
    same := a == b;
  }

  function {:extern "sameValue"} NativeEquality(a: Any, b: Any): bool
    ensures NativeEquality(a, b) == (a == b)

  method SameValue(a: Any, b: Any) returns (same: bool)
    ensures same == (a == b)
  {
    same := NativeEquality(a, b);
  }
}
