// Alternative: numeric UTF-16 units and native offsets. This requires a
// conversion of the input JS string to a sequence of code units at the boundary.
module CodeUnits {
  newtype {:nativeType "number"} Index = x: int | 0 <= x < 2147483647
  newtype {:nativeType "number"} CodeUnit = x: int | 0 <= x < 65536

  function FlowIndicator(c: CodeUnit): bool {
    c == 44 || c == 91 || c == 93 || c == 123 || c == 125
  }

  method FlowPlainLine(s: seq<CodeUnit>, from: Index) returns (p: Index)
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
      if FlowIndicator(c) || c == 58 || c == 35 || c == 10 || c == 13 {
        if c == 58 {
          if p + 1 == n {
            break;
          }
          var nc := s[p + 1];
          if nc == 32 || nc == 9 || nc == 10 || nc == 13 || FlowIndicator(nc) {
            break;
          }
        } else if c == 35 {
          if p > from {
            var prev := s[p - 1];
            if prev == 32 || prev == 9 {
              break;
            }
          }
        } else {
          break;
        }
      }
      p := p + 1;
    }
  }
}
