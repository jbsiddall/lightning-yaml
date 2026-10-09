// Same scan, using a bounded native JS number for offsets.
module Native {
  newtype {:nativeType "number"} Index = x: int | 0 <= x < 2147483647

  function FlowIndicator(c: char): bool {
    c == ',' || c == '[' || c == ']' || c == '{' || c == '}'
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
      var c := s[p];
      if FlowIndicator(c) || c == ':' || c == '#' || c == '\n' || c == '\r' {
        if c == ':' {
          if p + 1 == n {
            break;
          }
          var nc := s[p + 1];
          if nc == ' ' || nc == '\t' || nc == '\n' || nc == '\r' || FlowIndicator(nc) {
            break;
          }
        } else if c == '#' {
          if p > from {
            var prev := s[p - 1];
            if prev == ' ' || prev == '\t' {
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
