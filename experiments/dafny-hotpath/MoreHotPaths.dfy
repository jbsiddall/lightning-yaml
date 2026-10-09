// Three more parser operations from src/core.ts, on UTF-16 code units.
module MoreHotPaths {
  newtype {:nativeType "number"} Index = x: int | 0 <= x < 2147483647
  newtype {:nativeType "number"} CodeUnit = x: int | 0 <= x < 65536

  method BlockPlainEnd(s: seq<CodeUnit>, from: Index)
      returns (stop: Index, end: Index, atColon: bool)
    requires |s| < 2147483647
    requires from as int <= |s|
    ensures from <= end <= stop <= |s| as Index
  {
    var n: Index := |s| as Index;
    stop := from;
    atColon := false;
    while stop < n
      invariant from <= stop <= n
    {
      var c := s[stop];
      if c == 10 || c == 13 { break; }
      if c == 58 {
        if stop + 1 == n { atColon := true; break; }
        var next := s[stop + 1];
        if next == 32 || next == 9 || next == 10 || next == 13 {
          atColon := true;
          break;
        }
      } else if c == 35 && stop > from {
        var prev := s[stop - 1];
        if prev == 32 || prev == 9 { break; }
      }
      stop := stop + 1;
    }
    end := stop;
    while end > from
      invariant from <= end <= stop
    {
      var c := s[end - 1];
      if c != 32 && c != 9 { break; }
      end := end - 1;
    }
  }

  method MatchFlowKey(s: seq<CodeUnit>, pos: Index, key: seq<CodeUnit>)
      returns (nextPos: Index)
    requires |s| + |key| + 2 < 2147483647
    requires pos as int <= |s|
    ensures pos <= nextPos <= |s| as Index
  {
    var n: Index := |s| as Index;
    var k: Index := |key| as Index;
    nextPos := pos;
    if pos == n || s[pos] != 34 { return; }
    var q := pos + 1;
    var i: Index := 0;
    while i < k && q + i < n && s[q + i] == key[i]
      invariant 0 <= i <= k
    {
      i := i + 1;
    }
    if i == k && q + k < n && s[q + k] == 34 {
      nextPos := q + k + 1;
    }
  }

  method SimpleQuoteEnd(s: seq<CodeUnit>, from: Index) returns (end: Index)
    requires |s| < 2147483647
    requires from as int <= |s|
    ensures from <= end <= |s| as Index
  {
    var n: Index := |s| as Index;
    var p := from;
    while p < n
      invariant from <= p <= n
    {
      var c := s[p];
      if c == 34 { end := p; return; }
      if c == 92 || c == 10 { end := n; return; }
      p := p + 1;
    }
    end := n;
  }
}
