// Equivalent to src/core.ts:scanFlowPlainLine for one flow-scalar line.
module Scan {
  function FlowIndicator(c: char): bool {
    c == ',' || c == '[' || c == ']' || c == '{' || c == '}'
  }

  function PlainStopCandidate(c: char): bool {
    FlowIndicator(c) || c == ':' || c == '#' || c == '\n' || c == '\r'
  }

  method FlowPlainLine(s: string, from: nat) returns (p: nat)
    requires from <= |s|
    ensures from <= p <= |s|
  {
    p := from;
    while p < |s|
      invariant from <= p <= |s|
    {
      var c := s[p];
      if PlainStopCandidate(c) {
        if c == ':' {
          if p + 1 == |s| {
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
