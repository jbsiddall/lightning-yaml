// Compile with --unicode-char false: strings and offsets use UTF-16 units.
module Shapes {
  newtype {:nativeType "number"} Index = x: int | 0 <= x < 2147483647
  newtype {:nativeType "number"} Unit = x: int | 0 <= x < 65536

  method FlowPlainChars(s: string, from: Index) returns (p: Index)
    requires |s| < 2147483647
    requires from as int <= |s|
    ensures from <= p <= |s| as Index
  {
    var n: Index := |s| as Index;
    p := from;
    while p < n
      invariant from <= p <= n
    {
      var c := s[p];
      if c == ',' || c == '[' || c == ']' || c == '{' || c == '}' || c == '\n' || c == '\r' {
        break;
      }
      if c == ':' {
        if p + 1 == n { break; }
        var next := s[p + 1];
        if next == ' ' || next == '\t' || next == '\n' || next == '\r' ||
           next == ',' || next == '[' || next == ']' || next == '{' || next == '}' {
          break;
        }
      } else if c == '#' && p > from {
        var prev := s[p - 1];
        if prev == ' ' || prev == '\t' { break; }
      }
      p := p + 1;
    }
  }

  method QuoteChars(s: string, from: Index) returns (end: Index)
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
      if c == '"' { end := p; return; }
      if c == '\\' || c == '\n' { end := n; return; }
      p := p + 1;
    }
    end := n;
  }

  method FlowPlainLine(s: string, from: Index) returns (p: Index)
    requires |s| < 2147483647
    requires from as int <= |s|
    ensures from <= p <= |s| as Index
  {
    var n: Index := |s| as Index;
    p := from;
    while p < n
      invariant from <= p <= n
    {
      var c: Unit := (s[p] as int) as Unit;
      if c == 44 || c == 91 || c == 93 || c == 123 || c == 125 || c == 10 || c == 13 {
        break;
      }
      if c == 58 {
        if p + 1 == n { break; }
        var next: Unit := (s[p + 1] as int) as Unit;
        if next == 32 || next == 9 || next == 10 || next == 13 ||
           next == 44 || next == 91 || next == 93 || next == 123 || next == 125 {
          break;
        }
      } else if c == 35 && p > from {
        var prev: Unit := (s[p - 1] as int) as Unit;
        if prev == 32 || prev == 9 { break; }
      }
      p := p + 1;
    }
  }

  method QuoteEnd(s: string, from: Index) returns (end: Index)
    requires |s| < 2147483647
    requires from as int <= |s|
    ensures from <= end <= |s| as Index
  {
    var n: Index := |s| as Index;
    var p := from;
    while p < n
      invariant from <= p <= n
    {
      var c: Unit := (s[p] as int) as Unit;
      if c == 34 { end := p; return; }
      if c == 92 || c == 10 { end := n; return; }
      p := p + 1;
    }
    end := n;
  }
}
