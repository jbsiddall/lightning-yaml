// The extern's JS implementation is trusted to satisfy these contracts.
module Bridge {
  newtype {:nativeType "number"} Index = x: int | 0 <= x < 2147483647

  ghost function QuoteSpec(s: string, from: nat): nat
    requires from <= |s|
    ensures from <= QuoteSpec(s, from) <= |s|
    decreases |s| - from
  {
    if from == |s| then |s|
    else if s[from] == '"' then from
    else if s[from] == '\\' || s[from] == '\n' then |s|
    else QuoteSpec(s, from + 1)
  }

  function {:extern "quoteEnd"} NativeQuoteEnd(s: string, from: Index): (end: Index)
    requires |s| < 2147483647
    requires from as int <= |s|
    ensures end as int == QuoteSpec(s, from as int)

  method QuoteThroughExtern(s: string, from: Index) returns (end: Index)
    requires |s| < 2147483647
    requires from as int <= |s|
    ensures end as int == QuoteSpec(s, from as int)
  {
    end := NativeQuoteEnd(s, from);
  }
}
