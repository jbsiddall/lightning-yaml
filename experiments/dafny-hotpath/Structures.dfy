module Structures {
  newtype {:nativeType "number"} Count = x: int | 0 <= x < 2147483647
  datatype Value = Null | Number(value: Count) | Text(text: string) |
                   List(items: seq<Value>) | Object(fields: map<string, Value>)
  datatype ArrayBox = ArrayBox(items: array<Count>)

  method Nested() returns (v: Value) {
    var shared := Object(map["value" := Number(7)]);
    v := Object(map["child" := shared, "items" := List([shared]), "label" := Text("node")]);
  }

  method PlainArray(n: Count) returns (a: array<Count>)
    ensures a.Length == n as int
  {
    a := new Count[n as int];
    var i: Count := 0;
    while i < n
      invariant i <= n
    {
      a[i] := i;
      i := i + 1;
    }
  }

  method InitializedArray(n: Count) returns (a: array<Count>)
    ensures a.Length == n as int
  {
    a := new Count[n as int](_ => 0);
    var i: Count := 0;
    while i < n
      invariant i <= n
    {
      a[i] := i;
      i := i + 1;
    }
  }

  method WrappedArray(a: array<Count>) returns (b: ArrayBox) {
    b := ArrayBox(a);
  }

  method AppendSequence(n: Count) returns (values: seq<Count>)
    ensures |values| == n as int
  {
    values := [];
    var i: Count := 0;
    while i < n
      invariant i <= n
      invariant |values| == i as int
    {
      values := values + [i];
      i := i + 1;
    }
  }

  method BuildMap(keys: seq<string>) returns (values: map<string, Count>)
    requires |keys| < 2147483647
  {
    values := map[];
    var i: Count := 0;
    var n := |keys| as Count;
    while i < n
      invariant i <= n
      invariant n as int == |keys|
    {
      values := values[keys[i] := i];
      i := i + 1;
    }
  }

  datatype Model = Leaf(value: Count) | Branch(child: Model)
  class {:extern} HostValue {
    ghost var view: Model
  }

  method {:extern "leaf"} NewLeaf(value: Count) returns (r: HostValue)
    ensures fresh(r)
    ensures r.view == Leaf(value)

  method {:extern "branch"} NewBranch(child: HostValue) returns (r: HostValue)
    ensures fresh(r)
    ensures r.view == Branch(child.view)

  ghost function Expected(depth: Count): Model
    decreases depth
  {
    if depth == 0 then Leaf(7) else Branch(Expected(depth - 1))
  }

  method NativeTree(depth: Count) returns (r: HostValue)
    ensures fresh(r)
    ensures r.view == Expected(depth)
    decreases depth
  {
    if depth == 0 {
      r := NewLeaf(7);
    } else {
      var child := NativeTree(depth - 1);
      r := NewBranch(child);
    }
  }

  method NativeTreeIterative(depth: Count) returns (r: HostValue)
    ensures fresh(r)
    ensures r.view == Expected(depth)
  {
    r := NewLeaf(7);
    var i: Count := 0;
    while i < depth
      invariant i <= depth
      invariant fresh(r)
      invariant r.view == Expected(i)
    {
      r := NewBranch(r);
      i := i + 1;
    }
  }

  method {:extern "isLeaf"} IsLeaf(v: HostValue) returns (b: bool)
    ensures b == v.view.Leaf?

  method {:extern "child"} Child(v: HostValue) returns (r: HostValue)
    requires v.view.Branch?
    ensures r.view == v.view.child

  ghost function Depth(v: Model): nat {
    match v
      case Leaf(_) => 0
      case Branch(c) => 1 + Depth(c)
  }

  method ReadNativeTree(v: HostValue) returns (depth: Count)
    requires Depth(v.view) < 2147483647
    ensures depth as int == Depth(v.view)
  {
    depth := 0;
    var cursor := v;
    while true
      invariant depth as int + Depth(cursor.view) == Depth(v.view)
      decreases Depth(cursor.view)
    {
      var leaf := IsLeaf(cursor);
      if leaf { return; }
      cursor := Child(cursor);
      depth := depth + 1;
    }
  }

  method Identity(v: HostValue) returns (r: HostValue)
    ensures r == v
  {
    r := v;
  }
}
