module DafnyCore {
  import opened Native
  import opened TagValues

  class Engine {
    var src: string
    var pos: Index
    var len: Index
    var lineStart: Index
    var depth: Index
    var strict: bool
    var plainStoppedAtColon: bool
    var plainStoppedAtComment: bool
    var quotedMultiline: bool
    var flowFolded: string
    var hasFlowFolded: bool
    var flowWsCrossedLine: bool
    var flowSpanned: bool
    var flowIndentFloor: Counter
    var nextBackslash: Counter
    var nextNewline: Counter
    var keyCache: Map
    var keyCacheBytes: Value
    var keyCacheMaxBytes: Value
    var valueCache: Value
    var hasValueCache: bool
    var valueCacheEnabled: bool
    var lastRecordKeys: Value
    var hasLastRecordKeys: bool
    var tagHandles: Value
    var hasTagHandles: bool
    var anchorMap: Value
    var hasAnchorMap: bool
    var pendingAnchorName: string
    var hasPendingAnchorName: bool
    var afterInlineProperty: bool
    var inlineMapValue: bool
    var colOverride: Counter
    var bareDocAllowed: bool
    var foldedBreaks: Index
    var tagHelpers: Helpers
    var lastNumberIsFloat: bool

    constructor ()
    {
      new;
      tagHelpers := new Helpers();
      lastNumberIsFloat := false;
      Reset("", true, false, NumberValue(4194304));
    }

    method Reset(text: string, isStrict: bool, internValues: bool, keyCacheBudget: Value)
      requires |text| < 9007199254740000
      ensures src == text && pos <= len && len == |text| as Index && strict == isStrict && valueCacheEnabled == internValues
    {
      src := text;
      pos := 0;
      len := |text| as Index;
      lineStart := 0;
      depth := 0;
      strict := isStrict;
      plainStoppedAtColon := false;
      plainStoppedAtComment := false;
      quotedMultiline := false;
      flowFolded := "";
      hasFlowFolded := false;
      flowWsCrossedLine := false;
      flowSpanned := false;
      flowIndentFloor := -1;
      nextBackslash := -1;
      nextNewline := -1;
      keyCache := MapCreate();
      keyCacheBytes := NumberValue(0);
      keyCacheMaxBytes := keyCacheBudget;
      valueCache := Undefined;
      hasValueCache := false;
      valueCacheEnabled := internValues;
      lastRecordKeys := Undefined;
      hasLastRecordKeys := false;
      tagHandles := Undefined;
      hasTagHandles := false;
      anchorMap := Undefined;
      hasAnchorMap := false;
      pendingAnchorName := "";
      hasPendingAnchorName := false;
      afterInlineProperty := false;
      inlineMapValue := false;
      colOverride := -1;
      bareDocAllowed := true;
      foldedBreaks := 0;
      if len > 0 && (src[0] as Unit) == 65279 {
        pos := 1;
        lineStart := 1;
      }
    }

    function FlowIndicator(c: Unit): bool {
      c == 44 || c == 91 || c == 93 || c == 123 || c == 125
    }

    ghost predicate InlineWs(c: char) reads {} {
      c == ' ' || c == '\t'
    }

    ghost predicate LineBreak(c: char) reads {} {
      c == '\n' || c == '\r'
    }

    ghost predicate SpaceOrEolBoundaryAt(s: string, i: int) reads {}
      requires 0 <= i <= |s|
    {
      i == |s| || InlineWs(s[i]) || LineBreak(s[i])
    }

    ghost predicate DocumentMarkerAt(s: string, start: int, i: int) reads {}
      requires 0 <= i <= |s|
    {
      i == start && i + 3 <= |s| &&
      (s[i] == '-' || s[i] == '.') &&
      s[i + 1] == s[i] && s[i + 2] == s[i] &&
      SpaceOrEolBoundaryAt(s, i + 3)
    }

    ghost predicate FlowDelimiter(c: char) reads {} {
      c == ',' || c == '[' || c == ']' || c == '{' || c == '}'
    }

    ghost predicate SeparatorChar(c: char) reads {} {
      InlineWs(c) || LineBreak(c) || FlowDelimiter(c)
    }

    ghost predicate SeparatorAt(s: string, i: int) reads {}
      requires 0 <= i <= |s|
    {
      i == |s| || SeparatorChar(s[i])
    }

    ghost predicate PlainStop(s: string, start: int, i: int) reads {}
      requires 0 <= start <= i < |s|
    {
      FlowDelimiter(s[i]) || LineBreak(s[i]) ||
      (s[i] == ':' && SeparatorAt(s, i + 1)) ||
      (s[i] == '#' && start < i && InlineWs(s[i - 1]))
    }

    ghost predicate PlainPrefix(s: string, start: int, end: int) reads {}
      requires 0 <= start <= end <= |s|
    {
      forall k: int | start <= k < end :: !PlainStop(s, start, k)
    }

    ghost predicate FirstPlainStop(s: string, start: int, end: int) reads {}
      requires 0 <= start <= end <= |s|
    {
      PlainPrefix(s, start, end) &&
      (end == |s| || PlainStop(s, start, end))
    }

    ghost predicate WsRange(s: string, start: int, end: int) reads {}
      requires 0 <= start <= end <= |s|
    {
      forall k: int | start <= k < end :: InlineWs(s[k])
    }

    ghost predicate TrimmedEnd(s: string, from: int, end: int, p: int) reads {}
      requires 0 <= from <= p <= end <= |s|
    {
      WsRange(s, p, end) && (p == from || !InlineWs(s[p - 1]))
    }

    ghost predicate FirstNonInlineWs(s: string, from: int, p: int) reads {}
      requires 0 <= from <= p <= |s|
    {
      WsRange(s, from, p) && (p == |s| || !InlineWs(s[p]))
    }

    lemma CharFlowDelimiter(c: char)
      ensures FlowDelimiter(c) == FlowIndicator(c as Unit)
    {
      assert (c as Unit) == 44 <==> c == ',';
      assert (c as Unit) == 91 <==> c == '[';
      assert (c as Unit) == 93 <==> c == ']';
      assert (c as Unit) == 123 <==> c == '{';
      assert (c as Unit) == 125 <==> c == '}';
    }

    lemma PrefixExtend(s: string, start: int, p: int)
      requires 0 <= start <= p < |s|
      requires PlainPrefix(s, start, p) && !PlainStop(s, start, p)
      ensures PlainPrefix(s, start, p + 1)
    {
      forall k: int | start <= k < p + 1
        ensures !PlainStop(s, start, k)
      {
        if k < p {
          assert !PlainStop(s, start, k);
        } else {
          assert k == p;
          assert !PlainStop(s, start, p);
        }
      }
    }

    lemma WsRangeExtendLeft(s: string, from: int, p: int, end: int)
      requires 0 <= from < p <= end <= |s|
      requires WsRange(s, p, end) && InlineWs(s[p - 1])
      ensures WsRange(s, p - 1, end)
    {
      forall k: int | p - 1 <= k < end
        ensures InlineWs(s[k])
      {
        if k == p - 1 {
          assert InlineWs(s[p - 1]);
        } else {
          assert p <= k < end;
          assert InlineWs(s[k]);
        }
      }
    }

    function IsDigit(c: Unit): bool { 48 <= c < 58 }

    method FlowSeparatorAt(i: Index) returns (yes: bool)
      requires i as int <= len as int
      requires len as int == |src|
      ensures yes == SeparatorAt(src, i as int)
    {
      if i == len { yes := true; return; }
      var c := src[i] as Unit;
      yes := c == 32 || c == 9 || c == 10 || c == 13 || FlowIndicator(c);
    }

    method ScanFlowPlainLine(from: Index) returns (p: Index)
      requires from as int <= len as int
      requires len as int == |src|
      ensures from <= p <= len
      ensures FirstPlainStop(src, from as int, p as int)
    {
      p := from;
      while p < len
        invariant from <= p <= len
        invariant PlainPrefix(src, from as int, p as int)
        decreases (len as int) - (p as int)
      {
        var c := src[p] as Unit;
        CharFlowDelimiter(src[p]);
        if FlowIndicator(c) || c == 10 || c == 13 { break; }
        if c == 58 {
          if p + 1 == len { break; }
          var next := src[p + 1] as Unit;
          if next == 32 || next == 9 || next == 10 || next == 13 || FlowIndicator(next) { break; }
        } else if c == 35 && p > from {
          var prev := src[p - 1] as Unit;
          if prev == 32 || prev == 9 { break; }
        }
        PrefixExtend(src, from as int, p as int);
        p := p + 1;
      }
    }

    method TrimTrailingWs(from: Index, end: Index) returns (p: Index)
      requires from <= end && end <= len
      requires len as int == |src|
      ensures from <= p <= end
      ensures TrimmedEnd(src, from as int, end as int, p as int)
    {
      p := end;
      while p > from
        invariant from <= p <= end
        invariant WsRange(src, p as int, end as int)
        decreases (p as int) - (from as int)
      {
        var c := src[p - 1] as Unit;
        if c != 32 && c != 9 { break; }
        WsRangeExtendLeft(src, from as int, p as int, end as int);
        p := p - 1;
      }
    }

    method IsNullWord(s: string) returns (yes: bool)
      ensures yes == (s == "" || s == "~" || s == "null" || s == "Null" || s == "NULL")
    {
      yes := s == "" || s == "~" || s == "null" || s == "Null" || s == "NULL";
    }

    method IsBoolWord(s: string) returns (value: Value)
    {
      if s == "true" || s == "True" || s == "TRUE" { value := BoolValue(true); return; }
      if s == "false" || s == "False" || s == "FALSE" { value := BoolValue(false); return; }
      value := NotNumeric;
    }

    method HexValueGeneric(s: string, from: Index, to: Index) returns (value: Value)
      requires from <= to && to <= StringLength(s)
    {
      value := NotNumeric;
      if from >= to { return; }
      var p := from;
      var accumulator := NumberValue(0);
      while p < to {
        var digit := HexDigit(s[p] as Unit);
        if digit < 0 { return; }
        accumulator := NumberMulAdd(accumulator, 16, digit);
        p := p + 1;
      }
      value := accumulator;
    }

    method OctalValueGeneric(s: string, from: Index, to: Index) returns (value: Value)
      requires from <= to && to <= StringLength(s)
    {
      value := NotNumeric;
      if from >= to { return; }
      var p := from;
      var accumulator := NumberValue(0);
      while p < to {
        var c := s[p] as Unit;
        if c < 48 || c > 55 { return; }
        accumulator := NumberMulAdd(accumulator, 8, (c as Counter) - 48);
        p := p + 1;
      }
      value := accumulator;
    }

    method HexValue(from: Index, to: Index) returns (value: Value)
      requires from <= to && to <= len
    {
      value := NotNumeric;
      if from >= to { return; }
      var p := from;
      var accumulator := NumberValue(0);
      while p < to {
        var digit := HexDigit(src[p] as Unit);
        if digit < 0 { return; }
        accumulator := NumberMulAdd(accumulator, 16, digit);
        p := p + 1;
      }
      value := accumulator;
    }

    method OctalValue(from: Index, to: Index) returns (value: Value)
      requires from <= to && to <= len
    {
      value := NotNumeric;
      if from >= to { return; }
      var p := from;
      var accumulator := NumberValue(0);
      while p < to {
        var c := src[p] as Unit;
        if c < 48 || c > 55 { return; }
        accumulator := NumberMulAdd(accumulator, 8, (c as Counter) - 48);
        p := p + 1;
      }
      value := accumulator;
    }

    method TryNumber(from: Index, to: Index) returns (value: Value)
      requires from <= to && to <= len
    {
      value := NotNumeric;
      if from == to { return; }
      var p := from;
      var c := src[p] as Unit;
      var negative := c == 45;
      var signed := negative || c == 43;
      if signed {
        p := p + 1;
        if p == to { return; }
        c := src[p] as Unit;
      }
      if !signed && c == 48 && p + 1 < to {
        var base := src[p + 1] as Unit;
        if base == 120 || base == 111 {
          if base == 120 { value := HexValue(p + 2, to); }
          else { value := OctalValue(p + 2, to); }
          return;
        }
      }
      if c == 46 && to - p == 4 {
        var w1 := src[p + 1] as Unit;
        var w2 := src[p + 2] as Unit;
        var w3 := src[p + 3] as Unit;
        var inf := (w1 == 105 && w2 == 110 && w3 == 102) || (w1 == 73 && w2 == 110 && w3 == 102) || (w1 == 73 && w2 == 78 && w3 == 70);
        var nan := (w1 == 110 && w2 == 97 && w3 == 110) || (w1 == 78 && w2 == 97 && w3 == 78) || (w1 == 78 && w2 == 65 && w3 == 78);
        if inf { value := ParseSpecialNumber(if negative then "-Infinity" else "Infinity"); return; }
        if !signed && nan { value := ParseSpecialNumber("NaN"); return; }
      }
      var digitsSeen: Index := 0;
      var accumulator := NumberValue(0);
      while p < to
        invariant p <= to && digitsSeen <= to - from
      {
        var code := src[p] as Counter;
        var digit := code - 48;
        if digit < 0 || digit > 9 { break; }
        accumulator := NumberMulAdd(accumulator, 10, digit);
        digitsSeen := digitsSeen + 1;
        p := p + 1;
      }
      var isFloat := false;
      if p < to && (src[p] as Unit) == 46 {
        isFloat := true;
        p := p + 1;
        while p < to && IsDigit(src[p] as Unit)
          invariant p <= to && digitsSeen <= to - from
        {
          digitsSeen := digitsSeen + 1;
          p := p + 1;
        }
      }
      if digitsSeen == 0 { return; }
      if p < to && ((src[p] as Unit) == 101 || (src[p] as Unit) == 69) {
        isFloat := true;
        p := p + 1;
        if p < to && ((src[p] as Unit) == 43 || (src[p] as Unit) == 45) { p := p + 1; }
        var exponentStart := p;
        while p < to && IsDigit(src[p] as Unit)
          invariant exponentStart <= p <= to
        { p := p + 1; }
        if p == exponentStart { return; }
      }
      if p != to { return; }
      if !isFloat && digitsSeen <= 15 {
        value := if negative then NumberNegate(accumulator) else accumulator;
      } else { value := ParseNumber(Slice(src, from, to)); }
    }

    method TryNumberGeneric(s: string) returns (value: Value)
    {
      value := NotNumeric;
      lastNumberIsFloat := false;
      var n := StringLength(s);
      if n == 0 { return; }
      var p: Index := 0;
      var c := s[p] as Unit;
      var negative := c == 45;
      var signed := negative || c == 43;
      if signed {
        p := p + 1;
        if p >= n { return; }
        c := s[p] as Unit;
      }
      if !signed && c == 48 && p + 1 < n {
        var base := s[p + 1] as Unit;
        if base == 120 || base == 111 {
          if base == 120 { value := HexValueGeneric(s, p + 2, n); }
          else { value := OctalValueGeneric(s, p + 2, n); }
          return;
        }
      }
      if c == 46 && n - p == 4 {
        var a := s[p + 1] as Unit;
        var b := s[p + 2] as Unit;
        var d := s[p + 3] as Unit;
        var inf := (a == 105 && b == 110 && d == 102) || (a == 73 && b == 110 && d == 102) || (a == 73 && b == 78 && d == 70);
        var nan := (a == 110 && b == 97 && d == 110) || (a == 78 && b == 97 && d == 78) || (a == 78 && b == 65 && d == 78);
        if inf { lastNumberIsFloat := true; value := ParseSpecialNumber(if negative then "-Infinity" else "Infinity"); return; }
        if !signed && nan { lastNumberIsFloat := true; value := ParseSpecialNumber("NaN"); return; }
      }
      var digitsSeen: Index := 0;
      var accumulator := NumberValue(0);
      while p < n {
        var code := s[p] as Counter;
        var digit := code - 48;
        if digit < 0 || digit > 9 { break; }
        accumulator := NumberMulAdd(accumulator, 10, digit);
        digitsSeen := digitsSeen + 1;
        p := p + 1;
      }
      var isFloat := false;
      if p < n && (s[p] as Unit) == 46 {
        isFloat := true;
        p := p + 1;
        while p < n && IsDigit(s[p] as Unit) { digitsSeen := digitsSeen + 1; p := p + 1; }
      }
      if digitsSeen == 0 { return; }
      if p < n && ((s[p] as Unit) == 101 || (s[p] as Unit) == 69) {
        isFloat := true;
        p := p + 1;
        if p < n && ((s[p] as Unit) == 43 || (s[p] as Unit) == 45) { p := p + 1; }
        var exponentStart := p;
        while p < n && IsDigit(s[p] as Unit) { p := p + 1; }
        if p == exponentStart { return; }
      }
      if p == n {
        lastNumberIsFloat := isFloat;
        if !isFloat && digitsSeen <= 15 {
          value := if negative then NumberNegate(accumulator) else accumulator;
        }
        else { value := ParseNumber(s); }
      }
    }

    method ResolvePlain(from: Index, to: Index) returns (value: Value)
      requires from <= to && to <= len
    {
      if from == to { value := Null; return; }
      var c := src[from] as Unit;
      if IsDigit(c) || c == 45 || c == 43 || c == 46 {
        var number: Value;
        number := TryNumber(from, to);
        if !SameValue(number, NotNumeric) { value := number; return; }
      }
      var text := Slice(src, from, to);
      var isNull: bool;
      isNull := IsNullWord(text);
      if isNull { value := Null; return; }
      var boolValue: Value;
      boolValue := IsBoolWord(text);
      if !SameValue(boolValue, NotNumeric) { value := boolValue; return; }
      value := StringValue(text);
    }

    method ResolvePlainText(text: string) returns (value: Value)
    {
      if text == "" { value := Null; return; }
      var n := StringLength(text);
      var c := text[0] as Unit;
      if IsDigit(c) || c == 45 || c == 43 || c == 46 {
        var number: Value;
        number := TryNumberGeneric(text);
        if !SameValue(number, NotNumeric) { value := number; return; }
      }
      var isNull: bool;
      isNull := IsNullWord(text);
      if isNull { value := Null; return; }
      var boolValue: Value;
      boolValue := IsBoolWord(text);
      if !SameValue(boolValue, NotNumeric) { value := boolValue; return; }
      value := StringValue(text);
    }

    method SkipInlineSpaces()
      requires len as int == |src|
      requires pos <= len
      modifies this`pos
      ensures old(pos) <= pos <= len
      ensures FirstNonInlineWs(src, old(pos) as int, pos as int)
    {
      ghost var begin := pos;
      while pos < len && ((src[pos] as Unit) == 32 || (src[pos] as Unit) == 9)
        invariant begin <= pos <= len
        invariant WsRange(src, begin as int, pos as int)
        decreases (len as int) - (pos as int)
      {
        pos := pos + 1;
      }
    }

    method Fail(message: string)
    {
      if pos >= len { Native.Fail(Concat(message, ": unexpected end of input")); }
      var line: Index := 1;
      var column: Index := 1;
      var i: Index := 0;
      while i < pos
        invariant i <= pos && line >= 1 && column >= 1
      {
        if (src[i] as Unit) == 10 { line := line + 1; column := 1; }
        else { column := column + 1; }
        i := i + 1;
      }
      var msg := Concat(message, Concat(" (line ", ToString(NumberValue(line as Counter))));
      msg := Concat(msg, Concat(", column ", ToString(NumberValue(column as Counter))));
      Native.Fail(Concat(msg, ")"));
    }

    method SkipFlowWs()
    {
      if pos >= len { flowWsCrossedLine := false; return; }
      var first := src[pos] as Unit;
      if first != 32 && first != 9 && first != 10 && first != 13 && first != 35 && first != 45 && first != 46 {
        flowWsCrossedLine := false;
        return;
      }
      SkipFlowWsSlow();
    }

    method SkipFlowWsSlow()
    {
      flowWsCrossedLine := false;
      var p := pos;
      var lineHead: Counter := -1;
      var badTab := false;
      while p < len
        invariant pos <= p <= len && lineHead >= -1
      {
        var c := src[p] as Unit;
        if c == 32 || c == 9 || c == 10 || c == 13 {
          if c == 10 || c == 13 {
            flowWsCrossedLine := true;
            flowSpanned := true;
            lineHead := (p + 1) as Counter;
            badTab := false;
          } else if c == 9 && lineHead >= 0 && flowIndentFloor >= 0 && ((p as Counter) - lineHead) <= flowIndentFloor {
            badTab := true;
          }
          p := p + 1;
          continue;
        }
        if c == 35 {
          if p > 0 {
            var prev := src[p - 1] as Unit;
            if prev != 32 && prev != 9 && prev != 10 && prev != 13 {
              pos := p;
              Fail("a comment must be separated from other tokens by whitespace");
            }
          }
          var nl := IndexOf(src, "\n", p);
          if nl >= 0 {
            flowWsCrossedLine := true;
            flowSpanned := true;
          }
          p := if nl < 0 then len else (nl + 1) as Index;
          lineHead := p as Counter;
          badTab := false;
          continue;
        }
        if (c == 45 || c == 46) && (p == 0 || (src[p - 1] as Unit) == 10 || (src[p - 1] as Unit) == 13) {
          var marker: bool;
          marker := LooksLikeDocMarkerAt(p);
          if marker {
            pos := p;
            Fail("a document marker is not allowed inside a flow collection");
          }
        }
        if lineHead >= 0 && flowIndentFloor >= 0 && (badTab || ((p as Counter) - lineHead) <= flowIndentFloor) {
          pos := p;
          Fail("insufficient indentation for a multi-line flow collection");
        }
        break;
      }
      pos := p;
    }

    method ScanFlowPlainEnd() returns (end: Index)
      requires pos <= len
      ensures end == len || end >= pos
    {
      if pos < len {
        var initial := src[pos] as Unit;
        if initial == 37 || initial == 64 || initial == 96 || initial == 124 || initial == 62 {
          Fail("a plain scalar cannot start with '%', '@', '`', '|', or '>'");
        }
      }
      hasFlowFolded := false;
      flowFolded := "";
      var start := pos;
      var firstStop: Index;
      firstStop := ScanFlowPlainLine(start);
      var firstEnd: Index;
      firstEnd := TrimTrailingWs(start, firstStop);
      if firstStop < len && ((src[firstStop] as Unit) == 10 || (src[firstStop] as Unit) == 13) {
        end := FoldFlowPlain(start, firstEnd, firstStop);
      } else {
        pos := firstStop;
        end := firstEnd;
      }
    }

    method FoldFlowPlain(start: Index, firstEnd: Index, breakPos: Index) returns (lastEnd: Index)
      requires start <= firstEnd && firstEnd <= breakPos && breakPos < len
      ensures start <= lastEnd <= len
    {
      var result := "";
      var folded := false;
      lastEnd := firstEnd;
      var p := breakPos;
      while true
        invariant breakPos <= p <= len && start <= lastEnd <= len
      {
        var breaks: Index := 0;
        var q := p;
        while q < len
          invariant p <= q <= len
        {
          var c := src[q] as Unit;
          if c == 10 { q := q + 1; breaks := breaks + 1; }
          else if c == 13 {
            q := q + 1;
            if q < len && (src[q] as Unit) == 10 { q := q + 1; }
            breaks := breaks + 1;
          } else if c == 32 || c == 9 { q := q + 1; }
          else { break; }
        }
        var continues := q < len;
        if continues {
          var c := src[q] as Unit;
          if c == 44 || c == 93 || c == 125 || c == 35 { continues := false; }
          else if c == 58 {
            if q + 1 == len { continues := false; }
            else {
              var next := src[q + 1] as Unit;
              if next == 32 || next == 9 || next == 10 || next == 13 || FlowIndicator(next) { continues := false; }
            }
          } else if c == 45 || c == 46 {
            var marker := false;
            if q > 0 && ((src[q - 1] as Unit) == 10 || (src[q - 1] as Unit) == 13) { marker := LooksLikeDocMarkerAt(q); }
            if marker { continues := false; }
          }
        }
        if !continues { pos := p; break; }
        if !folded {
          result := Slice(src, start, firstEnd);
          folded := true;
          flowSpanned := true;
        }
        if breaks > 1 { result := Concat(result, Repeat("\n", breaks - 1)); }
        else { result := Concat(result, " "); }
        var segmentStop: Index;
        segmentStop := ScanFlowPlainLine(q);
        var segmentEnd: Index;
        segmentEnd := TrimTrailingWs(q, segmentStop);
        result := Concat(result, Slice(src, q, segmentEnd));
        lastEnd := segmentEnd;
        if segmentStop < len && ((src[segmentStop] as Unit) == 10 || (src[segmentStop] as Unit) == 13) {
          p := segmentStop;
          continue;
        }
        pos := segmentStop;
        flowFolded := result;
        hasFlowFolded := true;
        return;
      }
      if folded { flowFolded := result; hasFlowFolded := true; }
      else { lastEnd := firstEnd; }
    }

    method ParseFlowPlain() returns (value: Value)
    {
      var start := pos;
      var end: Index;
      end := ScanFlowPlainEnd();
      if end == start { Fail("expected a flow node"); }
      if hasFlowFolded { value := StringValue(flowFolded); }
      else { value := ResolvePlain(start, end); }
    }

    method StringifyKeyScalar(text: string) returns (rendered: string)
    {
      var n := StringLength(text);
      if n == 0 { rendered := JsonQuote(text); return; }
      var first := text[0] as Unit;
      var leading := first == 45 || first == 63 || first == 58 || first == 44 || first == 91 || first == 93 || first == 123 || first == 125 || first == 35 || first == 38 || first == 42 || first == 33 || first == 124 || first == 62 || first == 39 || first == 34 || first == 37 || first == 64 || first == 96;
      var structural := IndexOf(text, ": ", 0) >= 0 || IndexOf(text, " #", 0) >= 0 || IndexOf(text, "\n", 0) >= 0 || text[n - 1] == ':';
      var nullWord: bool;
      nullWord := IsNullWord(text);
      var boolWord: Value;
      boolWord := IsBoolWord(text);
      var number: Value;
      number := TryNumberGeneric(text);
      var retyped := nullWord || !SameValue(boolWord, NotNumeric) || !SameValue(number, NotNumeric);
      if leading || structural || retyped { rendered := JsonQuote(text); }
      else { rendered := text; }
    }

    method StringifyKeyValue(value: Value) returns (rendered: string)
    {
      if IsNull(value) { rendered := "null"; return; }
      if IsBoolean(value) {
        var boolean := BooleanValue(value);
        rendered := if boolean then "true" else "false";
        return;
      }
      if IsNumber(value) { rendered := FormatNumber(value); return; }
      if IsString(value) {
        var s := StringValueOf(value);
        rendered := StringifyKeyScalar(s);
        return;
      }
      if IsObject(value) { rendered := StringifyKeyNode(value); return; }
      rendered := StringFallback(value);
    }

    method StringifyKeyArray(items: Value, open: string, close: string) returns (rendered: string)
    {
      var n: Index;
      n := ArrayLength(items);
      if n == 0 { rendered := Concat(open, close); return; }
      rendered := Concat(open, " ");
      var i: Index := 0;
      while i < n
        invariant i <= n
      {
        if i > 0 { rendered := Concat(rendered, ", "); }
        var item: Value;
        item := ArrayGet(items, i);
        var itemText: string;
        itemText := StringifyKeyValue(item);
        rendered := Concat(rendered, itemText);
        i := i + 1;
      }
      rendered := Concat(rendered, Concat(" ", close));
    }

    method StringifyKeyMapping(value: Value, keys: Value, nativeMap: bool) returns (rendered: string)
    {
      var n: Index;
      n := ArrayLength(keys);
      if n == 0 { rendered := "{}"; return; }
      rendered := "{ ";
      var i: Index := 0;
      while i < n
        invariant i <= n
      {
        if i > 0 { rendered := Concat(rendered, ", "); }
        var keyValue: Value;
        keyValue := ArrayGet(keys, i);
        var keyText: string;
        if IsString(keyValue) { keyText := StringValueOf(keyValue); }
        else { keyText := KeyToString(keyValue); }
        var safeKey := StringifyKeyScalar(keyText);
        rendered := Concat(rendered, Concat(safeKey, ": "));
        var child: Value;
        if nativeMap {
          var nativeMapValue := MapFromValue(value);
          child := MapGet(nativeMapValue, keyValue);
        }
        else {
          if IsString(keyValue) { child := ObjectGet(value, StringValueOf(keyValue)); }
          else { child := ObjectGet(value, keyText); }
        }
        var childText: string;
        childText := StringifyKeyValue(child);
        rendered := Concat(rendered, childText);
        i := i + 1;
      }
      rendered := Concat(rendered, " }");
    }

    method StringifyKeyNode(value: Value) returns (rendered: string)
    {
      if IsArray(value) { rendered := StringifyKeyArray(value, "[", "]"); return; }
      if IsUint8Array(value) {
        var bytes := CreateArray();
        var n: Index;
        n := ByteLength(value);
        var i: Index := 0;
        while i < n { ArrayPush(bytes, NumberValue(ByteGet(value, i) as Counter)); i := i + 1; }
        rendered := StringifyKeyArray(bytes, "[", "]");
        return;
      }
      if IsSet(value) {
        var values: Value;
        values := SetValues(value);
        rendered := StringifyKeyArray(values, "[", "]");
        return;
      }
      if IsMap(value) {
        var mapKeys: Value;
        mapKeys := MapKeys(value);
        rendered := StringifyKeyMapping(value, mapKeys, true);
        return;
      }
      var keys: Value;
      keys := ObjectKeys(value);
      rendered := StringifyKeyMapping(value, keys, false);
    }

    method FastMatchBlockKey(expected: string) returns (matchedKey: bool)
    {
      matchedKey := false;
      if pos >= len { return; }
      var c := src[pos] as Unit;
      if c == 91 || c == 123 || c == 34 || c == 39 || c == 38 || c == 42 || c == 33 { return; }
      var n := StringLength(expected);
      if pos + n >= len { return; }
      var i: Index := 0;
      while i < n
        invariant i <= n
      {
        if (src[pos + i] as Unit) != (expected[i] as Unit) { return; }
        i := i + 1;
      }
      if (src[pos + n] as Unit) != 58 { return; }
      var separator: bool;
      separator := IsSpaceOrEolAt(pos + n + 1);
      if !separator { return; }
      pos := pos + n;
      matchedKey := true;
    }

    method KeyToString(value: Value) returns (key: string)
    {
      if IsString(value) { key := StringValueOf(value); return; }
      if IsNull(value) { key := ""; return; }
      if IsObject(value) { key := StringifyKeyNode(value); return; }
      key := StringFallback(value);
    }

    method InternNodeKey(value: Value) returns (key: string)
    {
      key := KeyToString(value);
      key := InternKey(key);
    }

    method InternKey(text: string) returns (key: string)
    {
      var value := StringValue(text);
      var cached := MapGet(keyCache, value);
      if !IsUndefined(cached) {
        key := StringValueOf(cached);
        return;
      }
      var bytes := NumberMulAdd(NumberValue(StringLength(text) as Counter), 2, 0);
      var total := NumberAdd(keyCacheBytes, bytes);
      var withinBudget: bool;
      withinBudget := NumberLessEqual(total, keyCacheMaxBytes);
      if withinBudget {
        MapSet(keyCache, value, value);
        keyCacheBytes := total;
      }
      key := text;
    }

    method StoreKey(target: Value, key: string, value: Value)
    {
      ObjectSetSafe(target, key, value);
    }

    method NumberBoundary(at: Index) returns (yes: bool)
      requires at <= len
    {
      if at >= len { yes := true; return; }
      var c := src[at] as Unit;
      if c == 44 || c == 93 || c == 125 || c == 10 || c == 13 { yes := true; return; }
      if c == 32 || c == 9 {
        var q := at + 1;
        while q < len && ((src[q] as Unit) == 32 || (src[q] as Unit) == 9)
          invariant at < q <= len
        { q := q + 1; }
        if q >= len { yes := true; return; }
        var next := src[q] as Unit;
        yes := next == 44 || next == 93 || next == 125 || next == 10 || next == 13 || next == 35 || next == 58;
        return;
      }
      if c == 58 {
        if at + 1 >= len { yes := true; return; }
        var next := src[at + 1] as Unit;
        yes := next == 32 || next == 9 || next == 10 || next == 13 || FlowIndicator(next);
        return;
      }
      yes := false;
    }

    method TryFlowNumber() returns (value: Value)
    {
      value := NotNumeric;
      var start := pos;
      var p := start;
      var c := src[p] as Unit;
      var negative := c == 45;
      var signed := negative || c == 43;
      if signed {
        p := p + 1;
        if p >= len { return; }
        c := src[p] as Unit;
      }
      if !signed && c == 48 {
        var base: Counter := if p + 1 < len then src[p + 1] as Counter else -1;
        if base == 120 || base == 111 {
          p := p + 2;
          var digits := p;
          var accumulator := NumberValue(0);
          var radix: Counter := if base == 120 then 16 else 8;
          while p < len {
            var ch := src[p] as Unit;
            var digit: Counter;
            if base == 120 {
              if IsDigit(ch) { digit := (ch as Counter) - 48; }
              else if 65 <= ch < 71 { digit := (ch as Counter) - 55; }
              else if 97 <= ch < 103 { digit := (ch as Counter) - 87; }
              else { digit := -1; }
            } else if 48 <= ch < 56 { digit := (ch as Counter) - 48; }
            else { digit := -1; }
            if digit < 0 { break; }
            accumulator := NumberMulAdd(accumulator, radix, digit);
            p := p + 1;
          }
          var boundary: bool;
          boundary := NumberBoundary(p);
          if p > digits && boundary { pos := p; value := accumulator; }
          return;
        }
      }
      if c == 46 && p + 3 < len {
        var a := src[p + 1] as Unit;
        var b := src[p + 2] as Unit;
        var d := src[p + 3] as Unit;
        var inf := (a == 105 && b == 110 && d == 102) || (a == 73 && b == 110 && d == 102) || (a == 73 && b == 78 && d == 70);
        var nan := (a == 110 && b == 97 && d == 110) || (a == 78 && b == 97 && d == 78) || (a == 78 && b == 65 && d == 78);
        var boundary: bool;
        boundary := NumberBoundary(p + 4);
        if inf && boundary {
          pos := p + 4;
          value := ParseSpecialNumber(if negative then "-Infinity" else "Infinity");
          return;
        }
        if !signed && nan && boundary {
          pos := p + 4;
          value := ParseSpecialNumber("NaN");
          return;
        }
      }
      var digitsSeen: Index := 0;
      var accumulator := NumberValue(0);
      while p < len {
        var code := src[p] as Counter;
        var digit := code - 48;
        if digit < 0 || digit > 9 { break; }
        accumulator := NumberMulAdd(accumulator, 10, digit);
        digitsSeen := digitsSeen + 1;
        p := p + 1;
      }
      var isFloat := false;
      if p < len && (src[p] as Unit) == 46 {
        isFloat := true;
        p := p + 1;
        while p < len && IsDigit(src[p] as Unit) { digitsSeen := digitsSeen + 1; p := p + 1; }
      }
      if digitsSeen == 0 { return; }
      if p < len && ((src[p] as Unit) == 101 || (src[p] as Unit) == 69) {
        isFloat := true;
        p := p + 1;
        if p < len && ((src[p] as Unit) == 43 || (src[p] as Unit) == 45) { p := p + 1; }
        var exponentStart := p;
        while p < len && IsDigit(src[p] as Unit) { p := p + 1; }
        if p == exponentStart { return; }
      }
      var boundary: bool;
      boundary := NumberBoundary(p);
      if !boundary { return; }
      pos := p;
      if !isFloat && digitsSeen <= 15 {
        value := if negative then NumberNegate(accumulator) else accumulator;
      } else { value := ParseNumber(Slice(src, start, p)); }
    }

    method ParseFlowValue() returns (value: Value)
    {
      if pos >= len { Fail("expected a flow node"); }
      var c := src[pos] as Unit;
      if c == 123 { value := ParseFlowMap(); return; }
      if c == 91 { value := ParseFlowSeq(); return; }
      if c == 34 { value := ParseDoubleQuoted(); return; }
      if c == 39 { value := ParseSingleQuoted(); return; }
      if c == 38 { value := ParseAnchoredFlowValue(); return; }
      if c == 33 { value := ParseTaggedFlowValue(); return; }
      if c == 42 { value := ParseAlias(); return; }
      if IsDigit(c) || c == 45 || c == 43 || c == 46 {
        var numericStart := pos;
        var number := TryFlowNumber();
        if !SameValue(number, NotNumeric) { value := number; return; }
        if c == 45 {
          var dashSeparator: bool;
          dashSeparator := FlowSeparatorAt(pos + 1);
          if dashSeparator { Fail("a block sequence '-' indicator is not allowed in a flow collection"); }
        }
        pos := numericStart;
      }
      value := ParseFlowPlain();
    }

    method ParseFlowKey() returns (key: string)
    {
      if pos >= len { Fail("expected a mapping key"); }
      var c := src[pos] as Unit;
      if c == 38 { key := ParseFlowKeyAnchored(); return; }
      if c == 33 { key := ParseFlowKeyTagged(); return; }
      if c == 42 {
        var alias: Value;
        alias := ParseAlias();
        var aliasKey: string;
        aliasKey := KeyToString(alias);
        key := InternKey(aliasKey);
        return;
      }
      if c == 34 {
        var quoted: Value;
        quoted := ParseDoubleQuoted();
        key := InternKey(StringValueOf(quoted));
        return;
      }
      if c == 39 {
        var quoted: Value;
        quoted := ParseSingleQuoted();
        key := InternKey(StringValueOf(quoted));
        return;
      }
      var start := pos;
      var end: Index;
      end := ScanFlowPlainEnd();
      if hasFlowFolded { key := InternKey(flowFolded); return; }
      if end == start { Fail("expected a mapping key"); }
      var plainKey := ResolvePlain(start, end);
      RegisterPendingAnchor(plainKey);
      var resolvedKey: string;
      resolvedKey := KeyToString(plainKey);
      key := InternKey(resolvedKey);
    }

    method ParseFlowKeyAnchored() returns (key: string)
    {
      pos := pos + 1;
      var name: string;
      name := ScanAnchorOrAliasName();
      SkipFlowWs();
      if pos < len && (src[pos] as Unit) == 38 { Fail("a node may carry at most one anchor"); }
      var tag := "";
      var hasTag := false;
      if pos < len && (src[pos] as Unit) == 33 {
        tag := ScanTag();
        CheckTagSeparator(true);
        hasTag := true;
        SkipFlowWs();
        if pos < len && (src[pos] as Unit) == 33 { Fail("a node may carry at most one tag"); }
        if pos < len && (src[pos] as Unit) == 38 { Fail("a node may carry at most one anchor"); }
      }
      if pos < len && (src[pos] as Unit) == 42 { Fail("an alias node cannot carry an anchor property"); }
      var savedName := pendingAnchorName;
      var savedHasName := hasPendingAnchorName;
      pendingAnchorName := name;
      hasPendingAnchorName := true;
      var raw: Value;
      if hasTag {
        raw := ParseTaggedFlowKeyRaw(tag);
        RegisterPendingAnchor(raw);
        var taggedKey: string;
        taggedKey := KeyToString(raw);
        key := InternKey(taggedKey);
      } else if pos < len && (src[pos] as Unit) == 34 {
        raw := ParseDoubleQuoted();
        RegisterPendingAnchor(raw);
        var quotedKey: string;
        quotedKey := KeyToString(raw);
        key := InternKey(quotedKey);
      } else if pos < len && (src[pos] as Unit) == 39 {
        raw := ParseSingleQuoted();
        RegisterPendingAnchor(raw);
        var singleQuotedKey: string;
        singleQuotedKey := KeyToString(raw);
        key := InternKey(singleQuotedKey);
      } else {
        var start := pos;
        var end: Index;
        end := ScanFlowPlainEnd();
        if hasFlowFolded {
          raw := StringValue(flowFolded);
          RegisterPendingAnchor(raw);
          var foldedKey: string;
          foldedKey := KeyToString(raw);
          key := InternKey(foldedKey);
        } else {
          if end == start { Fail("expected a mapping key"); }
          raw := ResolvePlain(start, end);
          RegisterPendingAnchor(raw);
          var resolvedKey: string;
          resolvedKey := KeyToString(raw);
          key := InternKey(resolvedKey);
        }
      }
      pendingAnchorName := savedName;
      hasPendingAnchorName := savedHasName;
    }

    method ParseFlowKeyTagged() returns (key: string)
    {
      var tag: string;
      tag := ScanTag();
      CheckTagSeparator(true);
      SkipFlowWs();
      if pos < len && (src[pos] as Unit) == 33 { Fail("a node may carry at most one tag"); }
      var anchorName := "";
      var touched := false;
      if pos < len && (src[pos] as Unit) == 38 {
        pos := pos + 1;
        anchorName := ScanAnchorOrAliasName();
        touched := true;
        SkipFlowWs();
        if pos < len && (src[pos] as Unit) == 38 { Fail("a node may carry at most one anchor"); }
        if pos < len && (src[pos] as Unit) == 33 { Fail("a node may carry at most one tag"); }
      }
      if pos < len && (src[pos] as Unit) == 42 { Fail("an alias node cannot carry a tag/anchor property"); }
      var savedName := pendingAnchorName;
      var savedHasName := hasPendingAnchorName;
      if touched { pendingAnchorName := anchorName; hasPendingAnchorName := true; }
      var raw: Value;
      raw := ParseTaggedFlowKeyRaw(tag);
      if touched {
        RegisterPendingAnchor(raw);
        pendingAnchorName := savedName;
        hasPendingAnchorName := savedHasName;
      }
      var taggedKey: string;
      taggedKey := KeyToString(raw);
      key := InternKey(taggedKey);
    }

    method ParseTaggedFlowKeyRaw(tag: string) returns (value: Value)
    {
      if pos < len && (src[pos] as Unit) == 34 {
        var quoted: Value;
        quoted := ParseDoubleQuoted();
        value := ApplyScalarTag(tag, StringValueOf(quoted));
        return;
      }
      if pos < len && (src[pos] as Unit) == 39 {
        var quoted: Value;
        quoted := ParseSingleQuoted();
        value := ApplyScalarTag(tag, StringValueOf(quoted));
        return;
      }
      if pos < len && (src[pos] as Unit) == 123 {
        var mapping: Value;
        mapping := ParseFlowMap();
        value := ApplyCollectionTag(tag, mapping, "map");
        return;
      }
      if pos < len && (src[pos] as Unit) == 91 {
        var sequence: Value;
        sequence := ParseFlowSeq();
        value := ApplyCollectionTag(tag, sequence, "seq");
        return;
      }
      var separator := pos >= len;
      if pos < len { separator := FlowSeparatorAt(pos); }
      if separator { value := ApplyScalarTag(tag, ""); return; }
      var start := pos;
      var end: Index;
      end := ScanFlowPlainEnd();
      var raw := if hasFlowFolded then flowFolded else Slice(src, start, end);
      if !hasFlowFolded { pos := end; }
      value := ApplyScalarTag(tag, raw);
    }

    method ScanAnchorOrAliasName() returns (name: string)
    {
      var start := pos;
      while pos < len
        invariant start <= pos <= len
      {
        var c := src[pos] as Unit;
        if c == 32 || c == 9 || c == 10 || c == 13 || FlowIndicator(c) { break; }
        pos := pos + 1;
      }
      if pos == start { Fail("anchor or alias name cannot be empty"); }
      name := Slice(src, start, pos);
    }

    method RegisterPendingAnchor(value: Value)
    {
      if hasPendingAnchorName {
        if !hasAnchorMap {
          var newAnchors := MapCreate();
          anchorMap := MapValue(newAnchors);
          hasAnchorMap := true;
        }
        var name := StringValue(pendingAnchorName);
        var anchors := MapFromValue(anchorMap);
        MapSet(anchors, name, value);
        hasPendingAnchorName := false;
      }
    }

    method ParseAlias() returns (value: Value)
    {
      pos := pos + 1;
      var name: string;
      name := ScanAnchorOrAliasName();
      SkipInlineSpaces();
      if !hasAnchorMap { Fail(Concat("unresolved alias '*", Concat(name, "' (no matching anchor)"))); }
      var key := StringValue(name);
      var anchors := MapFromValue(anchorMap);
      value := MapGet(anchors, key);
      if IsUndefined(value) { Fail(Concat("unresolved alias '*", Concat(name, "' (no matching anchor)"))); }
    }

    method IsTagWordChar(c: Unit) returns (yes: bool)
    {
      yes := IsDigit(c) || 65 <= c < 91 || 97 <= c < 123 || c == 45;
    }

    method IsTagSuffixChar(c: Unit) returns (yes: bool)
    {
      yes := c != 32 && c != 9 && c != 10 && c != 13 && c >= 32 && c != 33 && !FlowIndicator(c);
    }

    method ScanTagSuffixRaw() returns (suffix: string)
    {
      var start := pos;
      while pos < len
        invariant start <= pos <= len
      {
        var c := src[pos] as Unit;
        var valid: bool;
        valid := IsTagSuffixChar(c);
        if !valid { break; }
        pos := pos + 1;
      }
      suffix := Slice(src, start, pos);
    }

    method HexDigit(c: Unit) returns (value: Counter)
    {
      if 48 <= c < 58 { value := (c as Counter) - 48; return; }
      if 97 <= c < 103 { value := (c as Counter) - 87; return; }
      if 65 <= c < 71 { value := (c as Counter) - 55; return; }
      value := -1;
    }

    method DecodeTagPercent(s: string) returns (decoded: string)
    {
      var lenS := StringLength(s);
      var percent: Counter;
      percent := IndexOf(s, "%", 0);
      if percent < 0 { decoded := s; return; }
      decoded := "";
      var seg: Index := 0;
      var i: Index := 0;
      while i < lenS
        invariant seg <= i <= lenS
      {
        if (s[i] as Unit) == 37 {
          if i + 2 >= lenS { Fail("malformed '%' escape in a tag"); }
          var hi: Counter;
          var lo: Counter;
          hi := HexDigit(s[i + 1] as Unit);
          lo := HexDigit(s[i + 2] as Unit);
          if hi < 0 || lo < 0 { Fail("malformed '%' escape in a tag"); }
          decoded := Concat(decoded, Slice(s, seg, i));
          decoded := Concat(decoded, StringFromCharCode(((hi * 16 + lo) as Unit)));
          i := i + 3;
          seg := i;
        } else { i := i + 1; }
      }
      decoded := Concat(decoded, Slice(s, seg, lenS));
    }

    method ScanTag() returns (tag: string)
    {
      pos := pos + 1;
      if pos < len && (src[pos] as Unit) == 60 {
        pos := pos + 1;
        var start := pos;
        var gt: Counter;
        gt := IndexOf(src, ">", pos);
        if gt < 0 { Fail("unterminated verbatim tag: missing '>'"); }
        if gt == (pos as Counter) { Fail("a verbatim tag ('!<...>') must not be empty"); }
        var end := gt as Index;
        tag := Slice(src, start, end);
        pos := end + 1;
        return;
      }
      if pos < len && (src[pos] as Unit) == 33 {
        pos := pos + 1;
        var suffix: string;
        suffix := ScanTagSuffixRaw();
        var key := StringValue("!!");
        var tags := MapFromValue(tagHandles);
        var prefixValue := Undefined;
        if hasTagHandles { prefixValue := MapGet(tags, key); }
        var custom := !IsUndefined(prefixValue);
        var prefix := "tag:yaml.org,2002:";
        if custom { prefix := StringValueOf(prefixValue); }
        var decoded := DecodeTagPercent(suffix);
        tag := Concat(prefix, decoded);
        return;
      }
      var wordStart := pos;
      while pos < len
      {
        var c := src[pos] as Unit;
        var word: bool;
        word := IsTagWordChar(c);
        if !word { break; }
        pos := pos + 1;
      }
      if pos > wordStart && pos < len && (src[pos] as Unit) == 33 {
        var handle := Concat("!", Concat(Slice(src, wordStart, pos), "!"));
        pos := pos + 1;
        var suffix: string;
        suffix := ScanTagSuffixRaw();
        var key := StringValue(handle);
        var tags := MapFromValue(tagHandles);
        var prefixValue := Undefined;
        if hasTagHandles { prefixValue := MapGet(tags, key); }
        if IsUndefined(prefixValue) { Fail(Concat("undefined tag handle '", Concat(handle, "' (no matching %TAG directive in this document)"))); }
        var prefix := StringValueOf(prefixValue);
        var decoded := DecodeTagPercent(suffix);
        tag := Concat(prefix, decoded);
        return;
      }
      pos := wordStart;
      var primary: string;
      primary := ScanTagSuffixRaw();
      if primary == "" { tag := "!"; return; }
      var primaryKey := StringValue("!");
      var tags := MapFromValue(tagHandles);
      var primaryValue := Undefined;
      if hasTagHandles { primaryValue := MapGet(tags, primaryKey); }
      var primaryPrefix := "!";
      if !IsUndefined(primaryValue) { primaryPrefix := StringValueOf(primaryValue); }
      var decoded := DecodeTagPercent(primary);
      tag := Concat(primaryPrefix, decoded);
    }

    method CheckTagSeparator(inFlow: bool)
    {
      if pos >= len { return; }
      var c := src[pos] as Unit;
      if c == 32 || c == 9 || c == 10 || c == 13 { return; }
      if inFlow && FlowIndicator(c) { return; }
      Fail("a tag must be separated from the following content by whitespace");
    }

    method ApplyScalarTag(tag: string, raw: string) returns (value: Value)
    {
      if tag == "tag:yaml.org,2002:str" || tag == "!" { value := StringValue(raw); return; }
      if tag == "tag:yaml.org,2002:null" {
        if raw == "" || raw == "~" || raw == "null" || raw == "Null" || raw == "NULL" { value := Null; return; }
        Fail(Concat("!!null: '", Concat(raw, "' is not a valid core-schema null")));
      }
      if tag == "tag:yaml.org,2002:bool" {
        value := IsBoolWord(raw);
        if SameValue(value, NotNumeric) { Fail(Concat("!!bool: '", Concat(raw, "' is not a valid core-schema boolean"))); }
        return;
      }
      if tag == "tag:yaml.org,2002:int" || tag == "tag:yaml.org,2002:float" {
        var number := TryNumberGeneric(raw);
        if SameValue(number, NotNumeric) { Fail(Concat("!!", Concat(if tag == "tag:yaml.org,2002:int" then "int" else "float", Concat(": '", Concat(raw, "' is not a valid core-schema number"))))); }
        if tag == "tag:yaml.org,2002:int" && lastNumberIsFloat {
          Fail(Concat("!!int: '", Concat(raw, "' is not a valid core-schema integer")));
        }
        value := number;
        return;
      }
      if tag == "tag:yaml.org,2002:binary" {
        value := tagHelpers.DecodeBinary(raw);
        var binaryError: string;
        binaryError := tagHelpers.ErrorMessage();
        if binaryError != "" { Fail(binaryError); }
        return;
      }
      if tag == "tag:yaml.org,2002:map" || tag == "tag:yaml.org,2002:seq" || tag == "tag:yaml.org,2002:set" || tag == "tag:yaml.org,2002:omap" || tag == "tag:yaml.org,2002:pairs" {
        Fail("the collection tag requires a mapping/sequence node, not a scalar");
      }
      value := StringValue(raw);
    }

    method ParseTaggedFlowValue() returns (value: Value)
    {
      var tag: string;
      tag := ScanTag();
      CheckTagSeparator(true);
      SkipFlowWs();
      if pos < len && (src[pos] as Unit) == 33 { Fail("a node may carry at most one tag"); }
      var anchorName := "";
      var touched := false;
      if pos < len && (src[pos] as Unit) == 38 {
        pos := pos + 1;
        anchorName := ScanAnchorOrAliasName();
        touched := true;
        SkipFlowWs();
        if pos < len && (src[pos] as Unit) == 38 { Fail("a node may carry at most one anchor"); }
        if pos < len && (src[pos] as Unit) == 33 { Fail("a node may carry at most one tag"); }
      }
      if pos < len && (src[pos] as Unit) == 42 { Fail("an alias node cannot carry a tag/anchor property"); }
      var outerPending := pendingAnchorName;
      var hadOuterPending := hasPendingAnchorName;
      if touched { pendingAnchorName := anchorName; hasPendingAnchorName := true; }
      value := ParseTaggedFlowContent(tag);
      if touched {
        RegisterPendingAnchor(value);
        pendingAnchorName := outerPending;
        hasPendingAnchorName := hadOuterPending;
      }
    }

    method ParseTaggedFlowContent(tag: string) returns (value: Value)
    {
      if pos < len && (src[pos] as Unit) == 123 {
        value := ParseFlowMap();
        if tag != "tag:yaml.org,2002:map" && tag != "!" { Fail("tag does not match a flow mapping node"); }
        return;
      }
      if pos < len && (src[pos] as Unit) == 91 {
        value := ParseFlowSeq();
        if tag != "tag:yaml.org,2002:seq" && tag != "!" { Fail("tag does not match a flow sequence node"); }
        return;
      }
      if pos < len && (src[pos] as Unit) == 34 { var quoted: Value; quoted := ParseDoubleQuoted(); value := ApplyScalarTag(tag, StringValueOf(quoted)); return; }
      if pos < len && (src[pos] as Unit) == 39 { var quoted: Value; quoted := ParseSingleQuoted(); value := ApplyScalarTag(tag, StringValueOf(quoted)); return; }
      var separator := pos >= len;
      if pos < len { separator := FlowSeparatorAt(pos); }
      if separator { value := ApplyScalarTag(tag, ""); return; }
      var start := pos;
      var end: Index;
      end := ScanFlowPlainEnd();
      var raw := Slice(src, start, end);
      pos := end;
      value := ApplyScalarTag(tag, raw);
    }

    method ParseAnchoredFlowValue() returns (value: Value)
    {
      pos := pos + 1;
      var name: string;
      name := ScanAnchorOrAliasName();
      SkipInlineSpaces();
      var savedPending := pendingAnchorName;
      var hadSavedPending := hasPendingAnchorName;
      pendingAnchorName := name;
      hasPendingAnchorName := true;
      value := ParseFlowValue();
      RegisterPendingAnchor(value);
      pendingAnchorName := savedPending;
      hasPendingAnchorName := hadSavedPending;
    }

    method MakeSinglePair(key: string) returns (pair: Value)
    {
      pos := pos + 1;
      SkipFlowWs();
      var value: Value := Null;
      if pos < len && (src[pos] as Unit) != 44 && (src[pos] as Unit) != 93 && (src[pos] as Unit) != 125 {
        value := ParseFlowValue();
      }
      pair := CreateObject();
      StoreKey(pair, key, value);
      SkipFlowWs();
    }

    method ParseFlowExplicitEntry() returns (pair: Value)
    {
      pos := pos + 1;
      SkipFlowWs();
      var key := "";
      if pos < len && (src[pos] as Unit) != 58 && (src[pos] as Unit) != 44 && (src[pos] as Unit) != 93 && (src[pos] as Unit) != 125 {
        var keyValue := ParseFlowValue();
        key := KeyToString(keyValue);
      }
      SkipFlowWs();
      if pos < len && (src[pos] as Unit) == 58 { pair := MakeSinglePair(key); return; }
      pair := CreateObject();
      StoreKey(pair, key, Null);
    }

    method ParseFlowSeq() returns (result: Value)
    {
      depth := depth + 1;
      if depth > 1000 { Fail("maximum nesting depth exceeded"); }
      pos := pos + 1;
      result := CreateArray();
      RegisterPendingAnchor(result);
      SkipFlowWs();
      if pos < len && (src[pos] as Unit) == 93 { pos := pos + 1; depth := depth - 1; return; }
      while true
        invariant pos <= len && depth > 0
      {
        if pos >= len { Fail("expected ',' or ']' in flow sequence"); }
        var emptyKey: bool := false;
        if pos < len && (src[pos] as Unit) == 58 {
          emptyKey := FlowSeparatorAt(pos + 1);
        }
        if emptyKey {
          var emptyPair := MakeSinglePair("");
          ArrayPush(result, emptyPair);
        } else if (src[pos] as Unit) == 63 && pos + 1 < len {
          var questionSeparator: bool;
          questionSeparator := FlowSeparatorAt(pos + 1);
          if questionSeparator {
          var explicitPair := ParseFlowExplicitEntry();
          ArrayPush(result, explicitPair);
          } else {
            var item := ParseFlowValue();
            SkipFlowWs();
            if pos < len && (src[pos] as Unit) == 58 {
              if flowWsCrossedLine { Fail("an implicit key in a flow sequence must be on a single line"); }
              var itemKey := KeyToString(item);
              var pair := MakeSinglePair(itemKey);
              ArrayPush(result, pair);
            } else { ArrayPush(result, item); }
          }
        } else {
          var item := ParseFlowValue();
          SkipFlowWs();
          if pos < len && (src[pos] as Unit) == 58 {
            if flowWsCrossedLine { Fail("an implicit key in a flow sequence must be on a single line"); }
              var itemKey := KeyToString(item);
            var pair := MakeSinglePair(itemKey);
            ArrayPush(result, pair);
          } else { ArrayPush(result, item); }
        }
        SkipFlowWs();
        if pos < len && (src[pos] as Unit) == 44 {
          pos := pos + 1;
          SkipFlowWs();
          if pos < len && (src[pos] as Unit) == 93 { pos := pos + 1; depth := depth - 1; return; }
          continue;
        }
        if pos < len && (src[pos] as Unit) == 93 { pos := pos + 1; depth := depth - 1; return; }
        Fail("expected ',' or ']' in flow sequence");
      }
    }

    method ParseFlowMap() returns (result: Value)
    {
      depth := depth + 1;
      if depth > 1000 { Fail("maximum nesting depth exceeded"); }
      pos := pos + 1;
      result := CreateObject();
      RegisterPendingAnchor(result);
      var expected := lastRecordKeys;
      var hasExpected := hasLastRecordKeys;
      var expectedLength: Index := 0;
      if hasExpected { expectedLength := ArrayLength(expected); }
      var produced := expected;
      var matched := true;
      var keyCount: Index := 0;
      SkipFlowWs();
      if pos < len && (src[pos] as Unit) == 125 {
        pos := pos + 1;
        hasLastRecordKeys := false;
        lastRecordKeys := Undefined;
        depth := depth - 1;
        return;
      }
      while true
        invariant pos <= len && depth > 0
      {
        if pos >= len { Fail("expected ',' or '}' in flow mapping"); }
        var key := "";
        var c := src[pos] as Unit;
        var explicitKey := false;
        if c == 63 && pos + 1 < len {
          var questionSeparator: bool;
          questionSeparator := FlowSeparatorAt(pos + 1);
          if questionSeparator {
            explicitKey := true;
            pos := pos + 1;
            SkipFlowWs();
            if pos < len && (src[pos] as Unit) != 58 && (src[pos] as Unit) != 44 && (src[pos] as Unit) != 125 {
              var explicitKeyValue := ParseFlowValue();
              key := KeyToString(explicitKeyValue);
            }
          } else {
            var fast := false;
            if matched && hasExpected && keyCount < expectedLength && !hasPendingAnchorName {
              var expectedValue: Value;
              expectedValue := ArrayGet(expected, keyCount);
              var expectedKey := StringValueOf(expectedValue);
              fast := FastMatchFlowKey(expectedKey);
              if fast { key := expectedKey; }
            }
            if !fast { key := ParseFlowKey(); }
          }
        } else {
          var fast := false;
          if matched && hasExpected && keyCount < expectedLength && !hasPendingAnchorName {
            var expectedValue: Value;
            expectedValue := ArrayGet(expected, keyCount);
            var expectedKey := StringValueOf(expectedValue);
            fast := FastMatchFlowKey(expectedKey);
            if fast { key := expectedKey; }
          }
          if !fast { key := ParseFlowKey(); }
        }
        if matched && hasExpected && keyCount < expectedLength {
          var expectedValue: Value;
          expectedValue := ArrayGet(expected, keyCount);
          var expectedKey := StringValueOf(expectedValue);
          if expectedKey != key {
            produced := CreateArray();
            var copyIndex: Index := 0;
            while copyIndex < keyCount {
              var oldKey: Value;
              oldKey := ArrayGet(expected, copyIndex);
              ArrayPush(produced, oldKey);
              copyIndex := copyIndex + 1;
            }
            ArrayPush(produced, StringValue(key));
            matched := false;
          }
        } else if matched {
          produced := CreateArray();
          if hasExpected {
            var copyIndex: Index := 0;
            while copyIndex < keyCount {
              var oldKey: Value;
              oldKey := ArrayGet(expected, copyIndex);
              ArrayPush(produced, oldKey);
              copyIndex := copyIndex + 1;
            }
          }
          ArrayPush(produced, StringValue(key));
          matched := false;
        } else { ArrayPush(produced, StringValue(key)); }
        keyCount := keyCount + 1;
        SkipFlowWs();
        var value: Value := Null;
        if pos < len && (src[pos] as Unit) == 58 {
          pos := pos + 1;
          SkipFlowWs();
          if pos < len && (src[pos] as Unit) != 44 && (src[pos] as Unit) != 125 { value := ParseFlowValue(); }
        }
        StoreKey(result, key, value);
        SkipFlowWs();
        if pos < len && (src[pos] as Unit) == 44 {
          pos := pos + 1;
          SkipFlowWs();
          if pos < len && (src[pos] as Unit) == 125 {
            pos := pos + 1;
            PublishRecordKeys(expected, hasExpected, produced, matched, keyCount, expectedLength);
            depth := depth - 1;
            return;
          }
          continue;
        }
        if pos < len && (src[pos] as Unit) == 125 {
          pos := pos + 1;
          PublishRecordKeys(expected, hasExpected, produced, matched, keyCount, expectedLength);
          depth := depth - 1;
          return;
        }
        Fail("expected ',' or '}' in flow mapping");
      }
      PublishRecordKeys(expected, hasExpected, produced, matched, keyCount, expectedLength);
    }

    method FastMatchFlowKey(expected: string) returns (matchedKey: bool)
    {
      matchedKey := false;
      if pos >= len || (src[pos] as Unit) != 34 { return; }
      var n := StringLength(expected);
      if pos + n + 1 >= len { return; }
      var i: Index := 0;
      while i < n
        invariant i <= n
      {
        if (src[pos + 1 + i] as Unit) != (expected[i] as Unit) { return; }
        i := i + 1;
      }
      if (src[pos + 1 + n] as Unit) != 34 { return; }
      pos := pos + n + 2;
      matchedKey := true;
    }

    method PublishRecordKeys(expected: Value, hasExpected: bool, produced: Value, matched: bool, count: Index, expectedLength: Index)
    {
      if !matched { lastRecordKeys := produced; hasLastRecordKeys := true; return; }
      if count == 0 { lastRecordKeys := Undefined; hasLastRecordKeys := false; return; }
      if hasExpected && count == expectedLength { lastRecordKeys := expected; hasLastRecordKeys := true; return; }
      var result := CreateArray();
      var i: Index := 0;
      while i < count
        invariant i <= count
      {
        var key: Value;
        key := ArrayGet(expected, i);
        ArrayPush(result, key);
        i := i + 1;
      }
      lastRecordKeys := result;
      hasLastRecordKeys := true;
    }

    method IsSpaceOrEol(c: Unit) returns (yes: bool)
      ensures yes == (InlineWs(c as char) || LineBreak(c as char))
    {
      yes := c == 32 || c == 9 || c == 10 || c == 13;
    }

    method LooksLikeDocMarkerAt(i: Index) returns (yes: bool)
      requires i <= len
      requires len as int == |src|
      requires (i as int) + 2 < 9007199254740000
      ensures yes == DocumentMarkerAt(src, i as int, i as int)
    {
      yes := false;
      if i + 2 >= len { return; }
      var c := src[i] as Unit;
      if c != 45 && c != 46 { return; }
      if (src[i + 1] as Unit) != c || (src[i + 2] as Unit) != c { return; }
      if i + 3 >= len { yes := true; return; }
      yes := IsSpaceOrEol(src[i + 3] as Unit);
    }

    method InternValue(s: string) returns (value: Value)
    {
      value := StringValue(s);
      if !valueCacheEnabled { return; }
      if !hasValueCache {
        var newValues := MapCreate();
        valueCache := MapValue(newValues);
        hasValueCache := true;
      }
      var values := MapFromValue(valueCache);
      var cached := MapGet(values, value);
      if !IsUndefined(cached) { value := cached; return; }
      var cacheSize: Index;
      cacheSize := MapSize(values);
      if cacheSize < 1000000 { MapSet(values, value, value); }
    }

    method FoldFlowBreak(at: Index) returns (next: Index)
    {
      var i := at;
      var breaks: Index := 0;
      while true
        invariant at <= i <= len && breaks >= 0
      {
        if (src[i] as Unit) == 13 {
          i := i + 1;
          if i < len && (src[i] as Unit) == 10 { i := i + 1; }
        } else { i := i + 1; }
        breaks := breaks + 1;
        var isMarker: bool;
        isMarker := LooksLikeDocMarkerAt(i);
        if isMarker { Fail("unterminated quoted string: a document marker interrupts it"); }
        var ls := i;
        while i < len && ((src[i] as Unit) == 32 || (src[i] as Unit) == 9)
          invariant ls <= i <= len
        { i := i + 1; }
        if i >= len { Fail("unterminated quoted string"); }
        var cc := src[i] as Unit;
        if cc != 10 && cc != 13 {
          if flowIndentFloor >= 0 && ((i - ls) as Counter) <= flowIndentFloor {
            pos := i;
            Fail("insufficient indentation for a multi-line quoted scalar");
          }
          break;
        }
      }
      foldedBreaks := breaks;
      quotedMultiline := true;
      next := i;
    }

    method ParseDoubleQuoted() returns (value: Value)
    {
      quotedMultiline := false;
      var start := pos + 1;
      var e := IndexOf(src, "\"", start);
      if e == -1 { Fail("unterminated double-quoted string"); }
      if nextBackslash < (start as Counter) {
        var b := IndexOf(src, "\\", start);
        nextBackslash := if b == -1 then len as Counter else b;
      }
      if nextBackslash > e {
        if nextNewline < (start as Counter) {
          var n := IndexOf(src, "\n", start);
          nextNewline := if n == -1 then len as Counter else n;
        }
        if nextNewline > e {
          pos := (e + 1) as Index;
          value := InternValue(Slice(src, start, e as Index));
          return;
        }
      }
      value := ParseDoubleQuotedSlow(start);
    }

    method ParseDoubleQuotedSlow(start: Index) returns (value: Value)
    {
      var result := "";
      var seg := start;
      var i := start;
      while true
        invariant start <= seg <= i <= len
      {
        if i >= len { Fail("unterminated double-quoted string"); }
        var c := src[i] as Unit;
        if c == 34 {
          result := Concat(result, Slice(src, seg, i));
          pos := i + 1;
          value := StringValue(result);
          return;
        }
        if c == 92 {
          if i > seg { result := Concat(result, Slice(src, seg, i)); }
          i := i + 1;
          if i >= len { Fail("unterminated escape sequence"); }
          var ec := src[i] as Unit;
          if ec == 34 { result := Concat(result, "\""); i := i + 1; }
          else if ec == 92 { result := Concat(result, "\\"); i := i + 1; }
          else if ec == 47 { result := Concat(result, "/"); i := i + 1; }
          else if ec == 48 { result := Concat(result, "\u0000"); i := i + 1; }
          else if ec == 97 { result := Concat(result, "\u0007"); i := i + 1; }
          else if ec == 98 { result := Concat(result, "\u0008"); i := i + 1; }
          else if ec == 101 { result := Concat(result, "\u001b"); i := i + 1; }
          else if ec == 102 { result := Concat(result, "\u000c"); i := i + 1; }
          else if ec == 110 { result := Concat(result, "\n"); i := i + 1; }
          else if ec == 114 { result := Concat(result, "\r"); i := i + 1; }
          else if ec == 116 { result := Concat(result, "\t"); i := i + 1; }
          else if ec == 118 { result := Concat(result, "\u000b"); i := i + 1; }
          else if ec == 32 { result := Concat(result, " "); i := i + 1; }
          else if ec == 9 { result := Concat(result, "\t"); i := i + 1; }
          else if ec == 78 { result := Concat(result, "\u0085"); i := i + 1; }
          else if ec == 95 { result := Concat(result, "\u00a0"); i := i + 1; }
          else if ec == 76 { result := Concat(result, "\u2028"); i := i + 1; }
          else if ec == 80 { result := Concat(result, "\u2029"); i := i + 1; }
          else if ec == 120 {
            var hex := ReadHex(i + 1, 2);
            result := Concat(result, StringFromCharCode(hex as Unit));
            i := i + 3;
          } else if ec == 117 {
            var hex := ReadHex(i + 1, 4);
            result := Concat(result, StringFromCharCode(hex as Unit));
            i := i + 5;
          } else if ec == 85 {
            var cp := ReadHex(i + 1, 8);
            result := Concat(result, StringFromCodePoint(cp));
            i := i + 9;
          } else if ec == 10 {
            i := i + 1;
            while i < len && ((src[i] as Unit) == 32 || (src[i] as Unit) == 9) { i := i + 1; }
          } else if ec == 13 {
            i := i + 1;
            if i < len && (src[i] as Unit) == 10 { i := i + 1; }
            while i < len && ((src[i] as Unit) == 32 || (src[i] as Unit) == 9) { i := i + 1; }
          } else { Fail("invalid escape sequence in double-quoted string"); }
          seg := i;
          continue;
        }
        if c == 10 || c == 13 {
          var j := i;
          while j > seg && ((src[j - 1] as Unit) == 32 || (src[j - 1] as Unit) == 9) { j := j - 1; }
          result := Concat(result, Slice(src, seg, j));
          i := FoldFlowBreak(i);
          if foldedBreaks == 1 { result := Concat(result, " "); }
          else { result := Concat(result, Repeat("\n", foldedBreaks - 1)); }
          seg := i;
          continue;
        }
        i := i + 1;
      }
    }

    method ReadHex(start: Index, width: Index) returns (value: Counter)
    {
      if start + width > len { Fail("truncated \\x/\\u/\\U escape"); }
      value := 0;
      var k: Index := 0;
      while k < width
        invariant k <= width
      {
        var d: Counter;
        d := HexVal(src[start + k] as Unit);
        value := value * 16 + d;
        k := k + 1;
      }
    }

    method HexVal(c: Unit) returns (value: Counter)
    {
      if 48 <= c <= 57 { value := (c as Counter) - 48; return; }
      if 97 <= c <= 102 { value := (c as Counter) - 87; return; }
      if 65 <= c <= 70 { value := (c as Counter) - 55; return; }
      Fail("invalid hex digit in \\u escape");
      value := 0;
    }

    method ParseSingleQuoted() returns (value: Value)
    {
      quotedMultiline := false;
      var start := pos + 1;
      var e := IndexOf(src, "'", start);
      if e == -1 { Fail("unterminated single-quoted string"); }
      if e + 1 < len as Counter && (src[(e + 1) as Index] as Unit) == 39 {
        value := ParseSingleQuotedSlow(start);
        return;
      }
      if nextNewline < (start as Counter) {
        var n := IndexOf(src, "\n", start);
        nextNewline := if n == -1 then len as Counter else n;
      }
      if nextNewline < e {
        value := ParseSingleQuotedSlow(start);
        return;
      }
      pos := (e + 1) as Index;
      value := InternValue(Slice(src, start, e as Index));
    }

    method ParseSingleQuotedSlow(start: Index) returns (value: Value)
    {
      var result := "";
      var seg := start;
      var i := start;
      while true
        invariant start <= seg <= i <= len
      {
        if i >= len { Fail("unterminated single-quoted string"); }
        var c := src[i] as Unit;
        if c == 39 {
          if i + 1 < len && (src[i + 1] as Unit) == 39 {
            result := Concat(Concat(result, Slice(src, seg, i)), "'");
            i := i + 2;
            seg := i;
            continue;
          }
          result := Concat(result, Slice(src, seg, i));
          pos := i + 1;
          value := StringValue(result);
          return;
        }
        if c == 10 || c == 13 {
          var j := i;
          while j > seg && ((src[j - 1] as Unit) == 32 || (src[j - 1] as Unit) == 9) { j := j - 1; }
          result := Concat(result, Slice(src, seg, j));
          i := FoldFlowBreak(i);
          if foldedBreaks == 1 { result := Concat(result, " "); }
          else { result := Concat(result, Repeat("\n", foldedBreaks - 1)); }
          seg := i;
          continue;
        }
        i := i + 1;
      }
    }

    method DetectBlockScalarIndent(effParentCol: Counter) returns (indent: Index)
    {
      var p := pos;
      var maxBlankIndent: Counter := -1;
      while true
        invariant pos <= len && p <= len && maxBlankIndent >= -1
      {
        var marker: bool;
        marker := LooksLikeDocMarkerAt(p);
        if p >= len || marker {
          if maxBlankIndent > effParentCol { indent := maxBlankIndent as Index; }
          else { indent := (effParentCol + 1) as Index; }
          return;
        }

        var spaces: Index := 0;
        var q := p;
        while q < len && (src[q] as Unit) == 32
          invariant p <= q <= len && spaces <= q - p
        {
          spaces := spaces + 1;
          q := q + 1;
        }
        var r := q;
        while r < len
          invariant q <= r <= len
        {
          var rc := src[r] as Unit;
          if rc == 10 || rc == 13 { break; }
          if rc != 32 && rc != 9 { break; }
          r := r + 1;
        }
        var stop: Counter := -1;
        if r < len { stop := src[r] as Counter; }
        if stop == -1 || stop == 10 || stop == 13 {
          if (spaces as Counter) > maxBlankIndent { maxBlankIndent := spaces as Counter; }
          if stop == 10 { p := r + 1; }
          else if stop == 13 {
            if r + 1 < len && (src[r + 1] as Unit) == 10 { p := r + 2; }
            else { p := r + 1; }
          } else { p := len; }
          continue;
        }
        if (spaces as Counter) <= effParentCol {
          if maxBlankIndent > effParentCol { indent := maxBlankIndent as Index; }
          else { indent := (effParentCol + 1) as Index; }
          return;
        }
        if maxBlankIndent > (spaces as Counter) {
          Fail("a block scalar's leading empty lines must not be more indented than its first line of content");
        }
        indent := spaces;
        return;
      }
    }

    method SkipBlockScalarBlankLines()
    {
      while pos < len
        invariant pos <= len
      {
        while pos < len && ((src[pos] as Unit) == 32 || (src[pos] as Unit) == 9) { pos := pos + 1; }
        if pos >= len { return; }
        var c := src[pos] as Unit;
        if c == 10 { pos := pos + 1; lineStart := pos; continue; }
        if c == 13 {
          pos := pos + 1;
          if pos < len && (src[pos] as Unit) == 10 { pos := pos + 1; }
          lineStart := pos;
          continue;
        }
        if c == 35 {
          var nl := IndexOf(src, "\n", pos);
          if nl == -1 { pos := len; }
          else { pos := (nl + 1) as Index; }
          lineStart := pos;
          continue;
        }
        return;
      }
    }

    method ParseBlockScalar(parentCol: Counter) returns (value: Value)
    {
      var folded := (src[pos] as Unit) == 62;
      pos := pos + 1;
      var indentIndicator: Counter := 0;
      var chomp: Counter := 0;
      var headerCount: Index := 0;
      while headerCount < 2
        invariant headerCount <= 2 && indentIndicator >= 0 && chomp >= -1 && chomp <= 1
      {
        var c: Counter := -1;
        if pos < len { c := src[pos] as Counter; }
        if 49 <= c <= 57 && indentIndicator == 0 {
          indentIndicator := c - 48;
          pos := pos + 1;
        } else if c == 45 && chomp == 0 {
          chomp := -1;
          pos := pos + 1;
        } else if c == 43 && chomp == 0 {
          chomp := 1;
          pos := pos + 1;
        } else { break; }
        headerCount := headerCount + 1;
      }

      var sawSpace := false;
      while pos < len && ((src[pos] as Unit) == 32 || (src[pos] as Unit) == 9)
      {
        pos := pos + 1;
        sawSpace := true;
      }
      var afterHeader: Counter := -1;
      if pos < len { afterHeader := src[pos] as Counter; }
      if afterHeader == 35 {
        if !sawSpace { Fail("a comment after a block scalar header must be preceded by whitespace"); }
        var commentEnd := IndexOf(src, "\n", pos);
        if commentEnd == -1 { pos := len; }
        else { pos := commentEnd as Index; }
      } else if afterHeader != -1 && afterHeader != 10 && afterHeader != 13 {
        Fail("invalid block scalar header (expected an indentation indicator, chomping indicator, comment, or end of line)");
      }
      if pos < len {
        var c := src[pos] as Unit;
        if c == 10 { pos := pos + 1; }
        else if c == 13 {
          pos := pos + 1;
          if pos < len && (src[pos] as Unit) == 10 { pos := pos + 1; }
        }
      }
      lineStart := pos;

      var effParentCol := parentCol;
      if parentCol == -2 { effParentCol := -1; }
      var contentIndent: Index;
      if indentIndicator > 0 { contentIndent := (effParentCol + indentIndicator) as Index; }
      else { contentIndent := DetectBlockScalarIndent(effParentCol); }

      var result := "";
      var sawContent := false;
      var prevMoreIndented := false;
      var pendingBreaks: Index := 0;
      while true
        invariant pos <= len && pendingBreaks >= 0
      {
        if pos >= len { break; }
        var docMarker: bool;
        docMarker := IsDocMarkerAt(pos);
        if docMarker { break; }

        var count: Index := 0;
        var p := pos;
        while count < contentIndent
          invariant count <= contentIndent && pos <= p && p <= len
        {
          var c: Counter := -1;
          if p < len { c := src[p] as Counter; }
          if c == 32 {
            count := count + 1;
            p := p + 1;
            continue;
          }
          if c == 9 { Fail("tab characters are not allowed in block scalar indentation"); }
          break;
        }

        if count < contentIndent {
          var c: Counter := -1;
          if p < len { c := src[p] as Counter; }
          if c == -1 || c == 10 || c == 13 {
            pendingBreaks := pendingBreaks + 1;
            if c == 10 { pos := p + 1; }
            else if c == 13 {
              if p + 1 < len && (src[p + 1] as Unit) == 10 { pos := p + 2; }
              else { pos := p + 1; }
            } else { pos := len; }
            lineStart := pos;
            continue;
          }
          pos := p;
          break;
        }

        var nl := IndexOf(src, "\n", p);
        var lineEnd: Index;
        if nl == -1 { lineEnd := len; }
        else { lineEnd := nl as Index; }
        var textEnd := lineEnd;
        if textEnd > p && (src[textEnd - 1] as Unit) == 13 { textEnd := textEnd - 1; }
        var text := Slice(src, p, textEnd);

        if text == "" { pendingBreaks := pendingBreaks + 1; }
        else {
          var moreIndented := false;
          var firstUnit := CodeUnitAt(text, 0);
          if firstUnit == 32 || firstUnit == 9 { moreIndented := true; }
          if !sawContent {
            if pendingBreaks > 0 { result := Concat(result, Repeat("\n", pendingBreaks)); }
            result := Concat(result, text);
          } else if !folded {
            var breakCount: Index;
            if pendingBreaks == 0 { breakCount := 1; }
            else { breakCount := pendingBreaks + 1; }
            result := Concat(result, Repeat("\n", breakCount));
            result := Concat(result, text);
          } else {
            var moreInvolved := prevMoreIndented || moreIndented;
            if pendingBreaks == 0 && !moreInvolved {
              result := Concat(result, " ");
              result := Concat(result, text);
            } else if moreInvolved {
              var breakCount: Index;
              if pendingBreaks == 0 { breakCount := 1; }
              else { breakCount := pendingBreaks + 1; }
              result := Concat(result, Repeat("\n", breakCount));
              result := Concat(result, text);
            } else {
              result := Concat(result, Repeat("\n", pendingBreaks));
              result := Concat(result, text);
            }
          }
          sawContent := true;
          prevMoreIndented := moreIndented;
          pendingBreaks := 0;
        }
        if nl == -1 { pos := len; }
        else { pos := (nl + 1) as Index; }
        lineStart := pos;
      }

      SkipBlockScalarBlankLines();
      if !sawContent {
        if chomp == 1 { value := StringValue(Repeat("\n", pendingBreaks)); }
        else { value := StringValue(""); }
        return;
      }
      if chomp == -1 { value := StringValue(result); return; }
      if chomp == 1 { value := StringValue(Concat(result, Repeat("\n", pendingBreaks + 1))); return; }
      value := StringValue(Concat(result, "\n"));
    }

    method SkipBlankLines()
    {
      while pos < len
        invariant pos <= len
      {
        while pos < len && ((src[pos] as Unit) == 32 || (src[pos] as Unit) == 9) { pos := pos + 1; }
        if pos >= len { return; }
        var c := src[pos] as Unit;
        if c == 10 { pos := pos + 1; lineStart := pos; continue; }
        if c == 13 {
          pos := pos + 1;
          if pos < len && (src[pos] as Unit) == 10 { pos := pos + 1; }
          lineStart := pos;
          continue;
        }
        if c == 35 {
          while pos < len && (src[pos] as Unit) != 10 && (src[pos] as Unit) != 13 { pos := pos + 1; }
          if pos < len && (src[pos] as Unit) == 13 { pos := pos + 1; }
          if pos < len && (src[pos] as Unit) == 10 { pos := pos + 1; }
          lineStart := pos;
          continue;
        }
        return;
      }
    }

    method EndLine()
    {
      SkipInlineSpaces();
      if pos < len && (src[pos] as Unit) == 35 {
        if pos > lineStart {
          var prev := src[pos - 1] as Unit;
          if prev != 32 && prev != 9 { Fail("a comment must be separated from other tokens by whitespace"); }
        }
        while pos < len && (src[pos] as Unit) != 10 && (src[pos] as Unit) != 13 { pos := pos + 1; }
      }
      if pos >= len { return; }
      if (src[pos] as Unit) == 13 {
        pos := pos + 1;
        if pos < len && (src[pos] as Unit) == 10 { pos := pos + 1; }
        lineStart := pos;
        return;
      }
      if (src[pos] as Unit) == 10 { pos := pos + 1; lineStart := pos; return; }
      Fail("unexpected content at end of line");
    }

    method NextLine()
    {
      EndLine();
      SkipBlankLines();
    }

    method FinishDirectiveLine()
    {
      var nl: Counter;
      nl := IndexOf(src, "\n", pos);
      if nl < 0 { pos := len; }
      else { pos := (nl + 1) as Index; }
      lineStart := pos;
    }

    method ReadDirectiveToken() returns (token: string)
    {
      var start := pos;
      while pos < len
        invariant start <= pos <= len
      {
        var c := src[pos] as Unit;
        var space: bool;
        space := IsSpaceOrEol(c);
        if space { break; }
        pos := pos + 1;
      }
      token := Slice(src, start, pos);
    }

    method IsYamlVersionToken(s: string) returns (yes: bool)
    {
      yes := false;
      var n := StringLength(s);
      var i: Index := 0;
      var digits: Index := 0;
      while i < n && IsDigit(s[i] as Unit) { i := i + 1; digits := digits + 1; }
      if digits == 0 || i >= n || (s[i] as Unit) != 46 { return; }
      i := i + 1;
      digits := 0;
      while i < n && IsDigit(s[i] as Unit) { i := i + 1; digits := digits + 1; }
      yes := digits > 0 && i == n;
    }

    method ParseYamlDirectiveArgs()
    {
      SkipInlineSpaces();
      var token: string;
      token := ReadDirectiveToken();
      var validVersion: bool;
      validVersion := IsYamlVersionToken(token);
      if !validVersion { Fail("malformed %YAML directive: expected a MAJOR.MINOR version"); }
      var dot: Counter;
      dot := IndexOf(token, ".", 0);
      var majorText := Slice(token, 0, dot as Index);
      var major := NumberAsCounter(ParseNumber(majorText));
      if major != 1 { Fail(Concat("unsupported YAML major version: ", ToString(NumberValue(major)))); }
      SkipInlineSpaces();
      if pos < len {
        var c := src[pos] as Unit;
        if c != 10 && c != 13 && c != 35 { Fail("%YAML directive should contain exactly one part"); }
      }
    }

    method ParseTagDirectiveArgs()
    {
      SkipInlineSpaces();
      var handle: string;
      handle := ReadDirectiveToken();
      SkipInlineSpaces();
      var prefix: string;
      prefix := ReadDirectiveToken();
      if handle == "" || (handle[0] as Unit) != 33 || prefix == "" {
        Fail("malformed %TAG directive: expected a handle and a prefix");
      }
      if !hasTagHandles {
        var newTags := MapCreate();
        tagHandles := MapValue(newTags);
        hasTagHandles := true;
      }
      var key := StringValue(handle);
      var tags := MapFromValue(tagHandles);
      var duplicate: bool;
      duplicate := MapHas(tags, key);
      if duplicate { Fail(Concat("duplicate %TAG directive for handle '", Concat(handle, "'"))); }
      MapSet(tags, key, StringValue(prefix));
    }

    method ParseDirectives() returns (sawAny: bool)
    {
      tagHandles := Undefined;
      hasTagHandles := false;
      anchorMap := Undefined;
      hasAnchorMap := false;
      var sawYaml := false;
      sawAny := false;
      while pos < len && pos == lineStart && (src[pos] as Unit) == 37
        invariant pos <= len
      {
        sawAny := true;
        pos := pos + 1;
        var name := ReadDirectiveToken();
        if name == "YAML" {
          if sawYaml { Fail("a document must not contain more than one %YAML directive"); }
          sawYaml := true;
          ParseYamlDirectiveArgs();
        } else if name == "TAG" { ParseTagDirectiveArgs(); }
        FinishDirectiveLine();
        SkipBlankLines();
      }
    }

    method IsSpaceOrEolAt(i: Index) returns (yes: bool)
      requires i <= len
      requires len as int == |src|
      ensures yes == SpaceOrEolBoundaryAt(src, i as int)
    {
      if i == len { yes := true; return; }
      var c := src[i] as Unit;
      yes := c == 32 || c == 9 || c == 10 || c == 13;
    }

    method ScanBlockPlainEnd() returns (end: Index)
    {
      var start := pos;
      var p := pos;
      plainStoppedAtColon := false;
      plainStoppedAtComment := false;
      while p < len
        invariant pos <= p <= len
      {
        var c := src[p] as Unit;
        if c == 10 || c == 13 { break; }
        if c == 58 {
          if p + 1 == len { plainStoppedAtColon := true; break; }
          var next := src[p + 1] as Unit;
          if next == 32 || next == 9 || next == 10 || next == 13 { plainStoppedAtColon := true; break; }
        } else if c == 35 && p > start {
          var prev := src[p - 1] as Unit;
          if prev == 32 || prev == 9 { plainStoppedAtComment := true; break; }
        }
        p := p + 1;
      }
      pos := p;
      end := p;
      while end > start && ((src[end - 1] as Unit) == 32 || (src[end - 1] as Unit) == 9) { end := end - 1; }
    }

    method AdvanceCountingBreaks() returns (breaks: Index)
    {
      plainStoppedAtComment := false;
      SkipInlineSpaces();
      if pos < len && (src[pos] as Unit) == 35 {
        plainStoppedAtComment := true;
        var commentEnd: Counter;
        commentEnd := IndexOf(src, "\n", pos);
        if commentEnd < 0 { pos := len; }
        else { pos := commentEnd as Index; }
      }
      breaks := 0;
      while true
        invariant pos <= len && breaks >= 0
      {
        if pos >= len { return; }
        var c := src[pos] as Unit;
        if c == 10 {
          pos := pos + 1;
          lineStart := pos;
          breaks := breaks + 1;
          continue;
        }
        if c == 13 {
          pos := pos + 1;
          if pos < len && (src[pos] as Unit) == 10 { pos := pos + 1; }
          lineStart := pos;
          breaks := breaks + 1;
          continue;
        }
        var p := pos;
        while p < len && ((src[p] as Unit) == 32 || (src[p] as Unit) == 9) { p := p + 1; }
        if p >= len { pos := p; return; }
        var next := src[p] as Unit;
        if next == 10 || next == 13 { pos := p; continue; }
        if next == 35 {
          plainStoppedAtComment := true;
          var nl: Counter;
          nl := IndexOf(src, "\n", p);
          if nl < 0 { pos := len; }
          else { pos := (nl + 1) as Index; lineStart := pos; }
          continue;
        }
        pos := p;
        return;
      }
    }

    method ResolveBlockPlain(start: Index, end: Index, parentCol: Counter) returns (value: Value)
    {
      var breaks: Index;
      breaks := AdvanceCountingBreaks();
      var marker := false;
      if pos < len && pos == lineStart { marker := IsDocMarkerAt(pos); }
      if plainStoppedAtComment || pos >= len || ((pos - lineStart) as Counter) <= parentCol || marker {
        value := ResolvePlain(start, end);
        return;
      }
      var result := Slice(src, start, end);
      while true
        invariant pos <= len && breaks > 0
      {
        if breaks > 1 { result := Concat(result, Repeat("\n", breaks - 1)); }
        else { result := Concat(result, " "); }
        var segmentStart := pos;
        var segmentEnd: Index;
        segmentEnd := ScanBlockPlainEnd();
        result := Concat(result, Slice(src, segmentStart, segmentEnd));
        if plainStoppedAtColon { Fail("mapping value not allowed in a multi-line plain scalar"); }
        breaks := AdvanceCountingBreaks();
        marker := false;
        if pos < len && pos == lineStart { marker := IsDocMarkerAt(pos); }
        if plainStoppedAtComment || pos >= len || ((pos - lineStart) as Counter) <= parentCol || marker { break; }
      }
      value := StringValue(result);
    }

    method ResolveBlockPlainRaw(start: Index, end: Index, parentCol: Counter) returns (text: string)
    {
      var breaks: Index;
      breaks := AdvanceCountingBreaks();
      var marker := false;
      if pos < len && pos == lineStart { marker := IsDocMarkerAt(pos); }
      if plainStoppedAtComment || pos >= len || ((pos - lineStart) as Counter) <= parentCol || marker {
        text := Slice(src, start, end);
        return;
      }
      text := Slice(src, start, end);
      while true
        invariant pos <= len && breaks > 0
      {
        if breaks > 1 { text := Concat(text, Repeat("\n", breaks - 1)); }
        else { text := Concat(text, " "); }
        var segmentStart := pos;
        var segmentEnd: Index;
        segmentEnd := ScanBlockPlainEnd();
        text := Concat(text, Slice(src, segmentStart, segmentEnd));
        if plainStoppedAtColon { Fail("mapping value not allowed in a multi-line plain scalar"); }
        breaks := AdvanceCountingBreaks();
        marker := false;
        if pos < len && pos == lineStart { marker := IsDocMarkerAt(pos); }
        if plainStoppedAtComment || pos >= len || ((pos - lineStart) as Counter) <= parentCol || marker { break; }
      }
    }

    method ParseBlockValue(parentCol: Counter, isMapValue: bool) returns (value: Value)
    {
      SkipBlankLines();
      if pos >= len { value := Null; return; }
      var nextCol := (pos - lineStart) as Counter;
      if nextCol > parentCol {
        var wsStart := lineStart;
        var contentPos := pos;
        var firstChar := src[pos] as Unit;
        if parentCol >= 0 { CheckNoTabIndent(parentCol); }
        value := ParseBlockNode(parentCol, isMapValue);
        if strict { RejectBlockCollectionTabIndent(wsStart, contentPos, firstChar, value, parentCol); }
        return;
      }
      if isMapValue && nextCol == parentCol && (src[pos] as Unit) == 45 {
        var separator: bool;
        separator := IsSpaceOrEolAt(pos + 1);
        if separator { value := ParseBlockSeq(nextCol); return; }
      }
      value := Null;
    }

    method IsTabRestrictedCollection(value: Value) returns (yes: bool)
    {
      yes := false;
      if IsArray(value) { yes := true; return; }
      if IsObject(value) && !IsUint8Array(value) && !IsMap(value) && !IsSet(value) { yes := true; }
    }

    method IsPlainMapping(value: Value) returns (yes: bool)
    {
      yes := IsObject(value) && !IsArray(value) && !IsUint8Array(value) && !IsMap(value) && !IsSet(value);
    }

    method CheckNoTabIndent(parentCol: Counter)
    {
      if parentCol < 0 { return; }
      var i := lineStart;
      var limit := lineStart + (parentCol as Index) + 1;
      while i < limit && i < pos
        invariant lineStart <= i <= limit
      {
        if (src[i] as Unit) == 9 {
          pos := i;
          Fail("a tab character cannot be used as indentation");
        }
        i := i + 1;
      }
    }

    method RejectBlockCollectionTabIndent(wsStart: Index, contentPos: Index, firstChar: Unit, value: Value, parentCol: Counter)
    {
      var restricted: bool;
      restricted := IsTabRestrictedCollection(value);
      if !restricted { return; }
      if firstChar == 91 || firstChar == 123 || firstChar == 34 || firstChar == 39 || firstChar == 42 { return; }
      var i := if parentCol >= 0 then wsStart + (parentCol as Index) + 1 else wsStart;
      while i < contentPos
        invariant i <= contentPos
      {
        if (src[i] as Unit) == 9 {
          pos := i;
          Fail("a tab character cannot be used as indentation");
        }
        i := i + 1;
      }
    }

    method ParseRootBlockNode(parentCol: Counter) returns (value: Value)
    {
      var wsStart := lineStart;
      var contentPos := pos;
      var firstChar := src[pos] as Unit;
      value := ParseBlockNode(parentCol, false);
      if strict && parentCol != -2 { RejectBlockCollectionTabIndent(wsStart, contentPos, firstChar, value, parentCol); }
    }

    method ParseBlockNode(parentCol: Counter, isMapValue: bool) returns (value: Value)
    {
      var inlineProperty := afterInlineProperty;
      afterInlineProperty := false;
      var noBlockCollection := inlineMapValue;
      inlineMapValue := false;
      var col := if colOverride >= 0 then colOverride as Index else pos - lineStart;
      colOverride := -1;
      var c := src[pos] as Unit;
      if c == 38 {
        var anchorCol := col;
        pos := pos + 1;
        var name: string;
        name := ScanAnchorOrAliasName();
        var savedPending := pendingAnchorName;
        var hadSavedPending := hasPendingAnchorName;
        pendingAnchorName := name;
        hasPendingAnchorName := true;
        SkipInlineSpaces();
        if pos < len && (src[pos] as Unit) == 42 { Fail("an alias node cannot carry an anchor property"); }
        if pos >= len || (src[pos] as Unit) == 10 || (src[pos] as Unit) == 13 || (src[pos] as Unit) == 35 {
          var innerAnchor := pos < len;
          NextLine();
          innerAnchor := pos < len && (src[pos] as Unit) == 38;
          var effectiveParentCol := if parentCol == -2 then -1 else parentCol;
          value := ParseBlockValue(effectiveParentCol, isMapValue);
          var plainMapping: bool;
          plainMapping := IsPlainMapping(value);
          if innerAnchor && hasPendingAnchorName && pendingAnchorName == name && !plainMapping { Fail("a node can have at most one anchor"); }
        } else {
          afterInlineProperty := true;
          colOverride := anchorCol as Counter;
          value := ParseBlockNode(parentCol, isMapValue);
        }
        if hasPendingAnchorName && pendingAnchorName == name { RegisterPendingAnchor(value); }
        pendingAnchorName := savedPending;
        hasPendingAnchorName := hadSavedPending;
        return;
      }
      if c == 42 || c == 91 || c == 123 || c == 34 || c == 39 {
        flowSpanned := false;
        var savedFloor := flowIndentFloor;
        if c == 91 || c == 123 || c == 34 || c == 39 { flowIndentFloor := parentCol; }
        var node: Value;
        if c == 34 { quotedMultiline := false; node := ParseDoubleQuoted(); }
        else if c == 39 { quotedMultiline := false; node := ParseSingleQuoted(); }
        else if c == 42 { node := ParseAlias(); }
        else { node := ParseFlowValue(); }
        flowIndentFloor := savedFloor;
        var afterNode := pos;
        SkipInlineSpaces();
        var keySeparator := false;
        if pos < len && (src[pos] as Unit) == 58 { keySeparator := IsSpaceOrEolAt(pos + 1); }
        if keySeparator {
          if parentCol == -2 { Fail("a block mapping cannot start on the same line as a '---' document start"); }
          if noBlockCollection { Fail("a nested block mapping cannot start on the same line as a mapping key"); }
          if ((c == 34 || c == 39) && quotedMultiline) { Fail("a multi-line quoted scalar cannot be a block mapping key"); }
          if ((c == 91 || c == 123) && flowSpanned) { Fail("a multi-line flow collection cannot be a block mapping key"); }
          if inlineProperty { RegisterPendingAnchor(node); }
          var key := KeyToString(node);
          value := ParseBlockMap(col as Counter, key, true, false);
          return;
        }
        pos := afterNode;
        NextLine();
        value := node;
        RegisterPendingAnchor(value);
        return;
      }
      if c == 124 || c == 62 {
        value := ParseBlockScalar(parentCol);
        RegisterPendingAnchor(value);
        return;
      }
      var separator: bool;
      separator := IsSpaceOrEolAt(pos + 1);
      if c == 45 && separator {
        if parentCol == -2 { Fail("a block sequence cannot start on the same line as a '---' document start"); }
        if inlineProperty { Fail("a block sequence cannot start on the same line as a node property (anchor)"); }
        if noBlockCollection { Fail("a block sequence cannot start on the same line as a mapping key"); }
        value := ParseBlockSeq(col as Counter);
        return;
      }
      if c == 63 && separator {
        if parentCol == -2 { Fail("a block mapping cannot start on the same line as a '---' document start"); }
        if inlineProperty { Fail("a block mapping cannot start on the same line as a node property (anchor)"); }
        if noBlockCollection { Fail("a nested block mapping cannot start on the same line as a mapping key"); }
        value := ParseBlockMapExplicit(col as Counter);
        return;
      }
      if c == 33 { value := ParseTaggedBlockNode(parentCol, col as Counter, isMapValue); return; }
      if c == 37 || c == 64 || c == 96 { Fail("a plain scalar cannot start with a reserved indicator ('%', '@', or '`')"); }
      var start := pos;
      var end: Index;
      end := ScanBlockPlainEnd();
      if plainStoppedAtColon {
        if parentCol == -2 { Fail("a block mapping cannot start on the same line as a '---' document start"); }
        if noBlockCollection { Fail("a nested block mapping cannot start on the same line as a mapping key"); }
        var keyNode := ResolvePlain(start, end);
        if inlineProperty { RegisterPendingAnchor(keyNode); }
        var key := KeyToString(keyNode);
        value := ParseBlockMap(col as Counter, key, true, false);
        return;
      }
      value := ResolveBlockPlain(start, end, parentCol);
      RegisterPendingAnchor(value);
    }

    method ApplyCollectionTag(tag: string, value: Value, kind: string) returns (result: Value)
    {
      if tag == "!" || tag == "tag:yaml.org,2002:" { result := value; return; }
      if tag == "tag:yaml.org,2002:map" && kind == "map" { result := value; return; }
      if tag == "tag:yaml.org,2002:seq" && kind == "seq" { result := value; return; }
      if tag == "tag:yaml.org,2002:set" {
        if kind != "map" { Fail("the !!set tag requires a mapping node"); }
        result := tagHelpers.BuildSet(value);
        var setError: string;
        setError := tagHelpers.ErrorMessage();
        if setError != "" { Fail(setError); }
        return;
      }
      if tag == "tag:yaml.org,2002:omap" {
        if kind != "seq" { Fail("the !!omap tag requires a sequence node"); }
        result := tagHelpers.BuildOmap(value);
        var omapError: string;
        omapError := tagHelpers.ErrorMessage();
        if omapError != "" { Fail(omapError); }
        return;
      }
      if tag == "tag:yaml.org,2002:pairs" {
        if kind != "seq" { Fail("the !!pairs tag requires a sequence node"); }
        tagHelpers.ValidatePairs(value);
        var pairsError: string;
        pairsError := tagHelpers.ErrorMessage();
        if pairsError != "" { Fail(pairsError); }
        result := value;
        return;
      }
      if tag == "tag:yaml.org,2002:map" { Fail("the !!map tag requires a mapping node"); }
      if tag == "tag:yaml.org,2002:seq" { Fail("the !!seq tag requires a sequence node"); }
      if tag == "tag:yaml.org,2002:int" || tag == "tag:yaml.org,2002:float" || tag == "tag:yaml.org,2002:bool" || tag == "tag:yaml.org,2002:null" || tag == "tag:yaml.org,2002:binary" || tag == "tag:yaml.org,2002:str" {
        var tagName := Slice(tag, 18, StringLength(tag));
        var kindName := if kind == "map" then "mapping" else "sequence";
        Fail(Concat("the !!", Concat(tagName, Concat(" tag requires a scalar node, not a ", kindName))));
      }
      result := value;
    }

    method ParseTaggedBlockNode(parentCol: Counter, col: Counter, isMapValue: bool) returns (value: Value)
    {
      var savedPending := pendingAnchorName;
      var hadSavedPending := hasPendingAnchorName;
      var tag: string;
      tag := ScanTag();
      CheckTagSeparator(false);
      SkipInlineSpaces();
      if pos < len && (src[pos] as Unit) == 33 { Fail("a node may carry at most one tag"); }
      var hasAnchor := false;
      var anchorName := "";
      if pos < len && (src[pos] as Unit) == 38 {
        pos := pos + 1;
        anchorName := ScanAnchorOrAliasName();
        hasAnchor := true;
        pendingAnchorName := anchorName;
        hasPendingAnchorName := true;
        SkipInlineSpaces();
        if pos < len && (src[pos] as Unit) == 38 { Fail("a node may carry at most one anchor"); }
        if pos < len && (src[pos] as Unit) == 33 { Fail("a node may carry at most one tag"); }
      }
      if pos < len && (src[pos] as Unit) == 42 { Fail("an alias node cannot carry a tag/anchor property"); }
      var taggedDash := false;
      if pos < len && (src[pos] as Unit) == 45 { taggedDash := IsSpaceOrEolAt(pos + 1); }
      var taggedQuestion := false;
      if pos < len && (src[pos] as Unit) == 63 { taggedQuestion := IsSpaceOrEolAt(pos + 1); }
      if pos >= len || (src[pos] as Unit) == 10 || (src[pos] as Unit) == 13 || (src[pos] as Unit) == 35 {
        NextLine();
        var compactSequence := false;
        if pos < len && isMapValue && ((pos - lineStart) as Counter) == parentCol && (src[pos] as Unit) == 45 { compactSequence := IsSpaceOrEolAt(pos + 1); }
        if pos >= len || (((pos - lineStart) as Counter) <= parentCol && !compactSequence) {
          value := ApplyScalarTag(tag, "");
        } else {
          var effectiveParentCol := if parentCol == -2 then -1 else parentCol;
          var child := ParseBlockNode(effectiveParentCol, isMapValue);
          if IsArray(child) { value := ApplyCollectionTag(tag, child, "seq"); }
          else if IsObject(child) { value := ApplyCollectionTag(tag, child, "map"); }
          else if IsString(child) { value := ApplyScalarTag(tag, StringValueOf(child)); }
          else if tag == "!" || tag == "tag:yaml.org,2002:" || tag == "tag:yaml.org,2002:map" || tag == "tag:yaml.org,2002:seq" { value := child; }
          else { Fail("a tag cannot apply to an already-resolved nested scalar"); }
        }
      } else if taggedDash {
        if parentCol == -2 { Fail("a block sequence cannot start on the same line as a '---' document start"); }
        Fail("a block sequence cannot start on the same line as a node property (tag)");
      } else if taggedQuestion {
        if parentCol == -2 { Fail("a block mapping cannot start on the same line as a '---' document start"); }
        Fail("a block mapping cannot start on the same line as a node property (tag)");
      } else if (src[pos] as Unit) == 124 || (src[pos] as Unit) == 62 {
        var scalar := ParseBlockScalar(parentCol);
        value := ApplyScalarTag(tag, StringValueOf(scalar));
      } else if (src[pos] as Unit) == 45 {
        var dashSeparator: bool;
        dashSeparator := IsSpaceOrEolAt(pos + 1);
        if !dashSeparator { var start := pos; var end: Index; end := ScanBlockPlainEnd(); var raw := ResolveBlockPlainRaw(start, end, parentCol); value := ApplyScalarTag(tag, raw); return; }
        var sequenceValue := ParseBlockSeq(col);
        value := ApplyCollectionTag(tag, sequenceValue, "seq");
      } else if (src[pos] as Unit) == 91 || (src[pos] as Unit) == 123 || (src[pos] as Unit) == 34 || (src[pos] as Unit) == 39 {
        var c := src[pos] as Unit;
        var kind := if c == 91 then "seq" else if c == 123 then "map" else "scalar";
        var raw: Value;
        if c == 91 { raw := ParseFlowSeq(); }
        else if c == 123 { raw := ParseFlowMap(); }
        else if c == 34 { var quoted := ParseDoubleQuoted(); raw := StringValue(StringValueOf(quoted)); }
        else { var quoted := ParseSingleQuoted(); raw := StringValue(StringValueOf(quoted)); }
        SkipInlineSpaces();
        var keySeparator := false;
        if pos < len && (src[pos] as Unit) == 58 { keySeparator := IsSpaceOrEolAt(pos + 1); }
        if keySeparator {
          if parentCol == -2 { Fail("a block mapping cannot start on the same line as a '---' document start"); }
          var keyNode: Value;
          if kind == "scalar" { keyNode := ApplyScalarTag(tag, StringValueOf(raw)); }
          else { keyNode := ApplyCollectionTag(tag, raw, kind); }
          RegisterPendingAnchor(keyNode);
          var key: string;
          key := KeyToString(keyNode);
          value := ParseBlockMap(col, key, true, false);
        } else {
          NextLine();
          if kind == "scalar" { value := ApplyScalarTag(tag, StringValueOf(raw)); }
          else { value := ApplyCollectionTag(tag, raw, kind); }
        }
      } else {
        var start := pos;
        var end: Index;
        end := ScanBlockPlainEnd();
        if plainStoppedAtColon {
          if parentCol == -2 { Fail("a block mapping cannot start on the same line as a '---' document start"); }
          var keyNode := ApplyScalarTag(tag, Slice(src, start, end));
          RegisterPendingAnchor(keyNode);
          var keyText := KeyToString(keyNode);
          value := ParseBlockMap(col, keyText, true, false);
        } else {
          var raw := ResolveBlockPlainRaw(start, end, parentCol);
          value := ApplyScalarTag(tag, raw);
        }
      }
      if hasAnchor && hasPendingAnchorName && pendingAnchorName == anchorName { RegisterPendingAnchor(value); }
      pendingAnchorName := savedPending;
      hasPendingAnchorName := hadSavedPending;
    }

    method ParseBlockSeq(col: Counter) returns (result: Value)
    {
      depth := depth + 1;
      if depth > 1000 { Fail("maximum nesting depth exceeded"); }
      result := ParseBlockSeqBody(col);
      depth := depth - 1;
    }

    method ParseBlockSeqBody(col: Counter) returns (result: Value)
    {
      result := CreateArray();
      RegisterPendingAnchor(result);
      while true
        invariant pos <= len
      {
        if pos >= len || (src[pos] as Unit) != 45 { return; }
        var separator: bool;
        separator := IsSpaceOrEolAt(pos + 1);
        if !separator { return; }
        pos := pos + 1;
        var sawTab := false;
        while pos < len && ((src[pos] as Unit) == 32 || (src[pos] as Unit) == 9) {
          if (src[pos] as Unit) == 9 { sawTab := true; }
          pos := pos + 1;
        }
        var inlineTab := sawTab && pos < len && (src[pos] as Unit) != 10 && (src[pos] as Unit) != 13 && (src[pos] as Unit) != 35;
        if pos >= len || (src[pos] as Unit) == 10 || (src[pos] as Unit) == 13 || (src[pos] as Unit) == 35 {
          NextLine();
          if pos >= len || (pos - lineStart) as Counter <= col { ArrayPush(result, Null); }
          else {
            var nested: Value;
            nested := ParseBlockValue(col, false);
            ArrayPush(result, nested);
          }
        } else {
          var child: Value;
          child := ParseBlockNode(col, false);
          var restricted: bool;
          restricted := IsTabRestrictedCollection(child);
          if inlineTab && restricted { Fail("a tab cannot indent a block sequence entry that opens a new collection"); }
          ArrayPush(result, child);
        }
        if pos >= len || ((pos - lineStart) as Counter) != col { return; }
        if (src[pos] as Unit) != 45 { return; }
        separator := IsSpaceOrEolAt(pos + 1);
        if !separator { return; }
        if strict { CheckNoTabIndent(col - 1); }
      }
    }

    method ParseExplicitKey(col: Counter) returns (keyNode: Value)
    {
      var p := pos;
      var sawTab := false;
      while p < len && ((src[p] as Unit) == 32 || (src[p] as Unit) == 9) {
        if (src[p] as Unit) == 9 { sawTab := true; }
        p := p + 1;
      }
      var inlineContent := p < len && (src[p] as Unit) != 10 && (src[p] as Unit) != 13 && (src[p] as Unit) != 35;
      keyNode := ParseExplicitKeyBody(col);
      if sawTab && inlineContent {
        var restricted: bool;
        restricted := IsTabRestrictedCollection(keyNode);
        if restricted { Fail("a tab cannot separate '?' from a key that opens a new collection"); }
      }
    }

    method ParseExplicitKeyBody(col: Counter) returns (keyNode: Value)
    {
      SkipInlineSpaces();
      if pos >= len || (src[pos] as Unit) == 10 || (src[pos] as Unit) == 13 || (src[pos] as Unit) == 35 {
        NextLine();
        keyNode := ParseBlockValue(col, true);
        return;
      }
      keyNode := ParseBlockNode(col, false);
    }

    method ParseExplicitValue(col: Counter) returns (value: Value)
    {
      var p := pos;
      var sawTab := false;
      while p < len && ((src[p] as Unit) == 32 || (src[p] as Unit) == 9) {
        if (src[p] as Unit) == 9 { sawTab := true; }
        p := p + 1;
      }
      var inlineContent := p < len && (src[p] as Unit) != 10 && (src[p] as Unit) != 13 && (src[p] as Unit) != 35;
      value := ParseExplicitValueBody(col);
      if sawTab && inlineContent {
        var restricted: bool;
        restricted := IsTabRestrictedCollection(value);
        if restricted { Fail("a tab cannot separate ':' from a value that opens a new collection"); }
      }
    }

    method ParseExplicitValueBody(col: Counter) returns (value: Value)
    {
      SkipInlineSpaces();
      if pos >= len || (src[pos] as Unit) == 10 || (src[pos] as Unit) == 13 || (src[pos] as Unit) == 35 {
        NextLine();
        value := ParseBlockValue(col, true);
        return;
      }
      value := ParseBlockNode(col, false);
    }

    method ExplicitPairHasValue(col: Counter) returns (hasValue: bool)
    {
      hasValue := false;
      if pos < len && ((pos - lineStart) as Counter) == col && (src[pos] as Unit) == 58 {
        hasValue := true;
      }
    }

    method ParseBlockMapExplicit(col: Counter) returns (result: Value)
    {
      result := ParseBlockMapExplicitBody(col);
    }

    method ParseBlockMapExplicitBody(col: Counter) returns (result: Value)
    {
      pos := pos + 1;
      var keyNode := ParseExplicitKey(col);
      var keyText: string;
      keyText := KeyToString(keyNode);
      var key := InternKey(keyText);
      var hasValue := ExplicitPairHasValue(col);
      result := ParseBlockMap(col, key, hasValue, true);
    }

    method ParseBlockMap(col: Counter, firstKey: string, firstHasValue: bool, firstIsExplicit: bool) returns (result: Value)
    {
      depth := depth + 1;
      if depth > 1000 { Fail("maximum nesting depth exceeded"); }
      result := ParseBlockMapBody(col, firstKey, firstHasValue, firstIsExplicit);
      depth := depth - 1;
    }

    method ParseBlockMapKey() returns (key: string)
    {
      var c := src[pos] as Unit;
      if c == 38 { key := ParseBlockMapKeyAnchored(); return; }
      if c == 33 { key := ParseBlockMapKeyTagged(); return; }
      if c == 42 {
        var node := ParseAlias();
        var sep := false;
        if pos < len && (src[pos] as Unit) == 58 { sep := IsSpaceOrEolAt(pos + 1); }
        if !sep { Fail("expected ':' after mapping key"); }
        key := InternNodeKey(node);
        return;
      }
      if c == 34 || c == 39 || c == 91 || c == 123 {
        var node: Value;
        if c == 34 { quotedMultiline := false; node := ParseDoubleQuoted(); }
        else if c == 39 { quotedMultiline := false; node := ParseSingleQuoted(); }
        else { node := ParseFlowValue(); }
        RegisterPendingAnchor(node);
        if (c == 34 || c == 39) && quotedMultiline { Fail("a multi-line quoted scalar cannot be a block mapping key"); }
        SkipInlineSpaces();
        var sep := false;
        if pos < len && (src[pos] as Unit) == 58 { sep := IsSpaceOrEolAt(pos + 1); }
        if !sep { Fail("expected ':' after mapping key"); }
        key := InternNodeKey(node);
        return;
      }
      var start := pos;
      var end: Index;
      end := ScanBlockPlainEnd();
      if !plainStoppedAtColon { Fail("expected ':' after mapping key"); }
      var node := ResolvePlain(start, end);
      RegisterPendingAnchor(node);
      key := InternNodeKey(node);
    }

    method ParseBlockMapKeyAnchored() returns (key: string)
    {
      pos := pos + 1;
      var name: string;
      name := ScanAnchorOrAliasName();
      SkipInlineSpaces();
      var c: Counter := -1;
      if pos < len { c := src[pos] as Counter; }
      if c == 38 { Fail("a node may carry at most one anchor"); }
      var tag: string := "";
      var hasTag := false;
      if c == 33 {
        tag := ScanTag();
        CheckTagSeparator(false);
        SkipInlineSpaces();
        c := -1;
        if pos < len { c := src[pos] as Counter; }
        if c == 33 { Fail("a node may carry at most one tag"); }
        if c == 38 { Fail("a node may carry at most one anchor"); }
        hasTag := true;
      }
      if c == 42 { Fail("an alias node cannot carry an anchor property"); }
      var savedPending := pendingAnchorName;
      var hadSavedPending := hasPendingAnchorName;
      pendingAnchorName := name;
      hasPendingAnchorName := true;
      if hasTag {
        var node := ParseTaggedBlockMapKeyRaw(tag, c as Unit);
        RegisterPendingAnchor(node);
        key := InternNodeKey(node);
      } else {
        key := ParseBlockMapKey();
      }
      pendingAnchorName := savedPending;
      hasPendingAnchorName := hadSavedPending;
    }

    method ParseBlockMapKeyTagged() returns (key: string)
    {
      var tag: string;
      tag := ScanTag();
      CheckTagSeparator(false);
      SkipInlineSpaces();
      var c: Counter := -1;
      if pos < len { c := src[pos] as Counter; }
      if c == 33 { Fail("a node may carry at most one tag"); }
      var anchorName: string := "";
      var hasAnchor := false;
      if c == 38 {
        pos := pos + 1;
        anchorName := ScanAnchorOrAliasName();
        SkipInlineSpaces();
        c := -1;
        if pos < len { c := src[pos] as Counter; }
        if c == 38 { Fail("a node may carry at most one anchor"); }
        if c == 33 { Fail("a node may carry at most one tag"); }
        hasAnchor := true;
      }
      if c == 42 { Fail("an alias node cannot carry a tag/anchor property"); }
      var savedPending := pendingAnchorName;
      var hadSavedPending := hasPendingAnchorName;
      if hasAnchor { pendingAnchorName := anchorName; hasPendingAnchorName := true; }
      var node := ParseTaggedBlockMapKeyRaw(tag, c as Unit);
      if hasAnchor { RegisterPendingAnchor(node); }
      pendingAnchorName := savedPending;
      hasPendingAnchorName := hadSavedPending;
      key := InternNodeKey(node);
    }

    method ParseTaggedBlockMapKeyRaw(tag: string, c: Unit) returns (node: Value)
    {
      if c == 34 || c == 39 || c == 91 || c == 123 {
        if c == 34 { var quoted := ParseDoubleQuoted(); node := ApplyScalarTag(tag, StringValueOf(quoted)); }
        else if c == 39 { var quoted := ParseSingleQuoted(); node := ApplyScalarTag(tag, StringValueOf(quoted)); }
        else if c == 91 { var sequence := ParseFlowSeq(); node := ApplyCollectionTag(tag, sequence, "seq"); }
        else { var mapping := ParseFlowMap(); node := ApplyCollectionTag(tag, mapping, "map"); }
        SkipInlineSpaces();
        var sep := false;
        if pos < len && (src[pos] as Unit) == 58 { sep := IsSpaceOrEolAt(pos + 1); }
        if !sep { Fail("expected ':' after mapping key"); }
        return;
      }
      var start := pos;
      var end: Index;
      end := ScanBlockPlainEnd();
      if !plainStoppedAtColon { Fail("expected ':' after mapping key"); }
      node := ApplyScalarTag(tag, Slice(src, start, end));
    }

    method ParseBlockMapBody(col: Counter, firstKey: string, firstHasValue: bool, firstIsExplicit: bool) returns (result: Value)
    {
      result := CreateObject();
      RegisterPendingAnchor(result);
      var key := firstKey;
      if !firstIsExplicit { key := InternKey(key); }
      var hasValue := firstHasValue;
      var isExplicit := firstIsExplicit;
      var expected := lastRecordKeys;
      var hasExpected := hasLastRecordKeys;
      var expectedLength: Index := 0;
      if hasExpected { expectedLength := ArrayLength(expected); }
      var produced := expected;
      var matched := true;
      var keyCount: Index := 0;
      while true
        invariant pos <= len
      {
        if matched && hasExpected && keyCount < expectedLength {
          var expectedValue: Value;
          expectedValue := ArrayGet(expected, keyCount);
          if StringValueOf(expectedValue) != key {
            produced := CreateArray();
            var copyIndex: Index := 0;
            while copyIndex < keyCount {
              var previous: Value;
              previous := ArrayGet(expected, copyIndex);
              ArrayPush(produced, previous);
              copyIndex := copyIndex + 1;
            }
            ArrayPush(produced, StringValue(key));
            matched := false;
          }
        } else if matched {
          produced := CreateArray();
          if hasExpected {
            var copyIndex: Index := 0;
            while copyIndex < keyCount {
              var previous: Value;
              previous := ArrayGet(expected, copyIndex);
              ArrayPush(produced, previous);
              copyIndex := copyIndex + 1;
            }
          }
          ArrayPush(produced, StringValue(key));
          matched := false;
        } else { ArrayPush(produced, StringValue(key)); }
        keyCount := keyCount + 1;
        var value: Value := Null;
        if hasValue {
          if pos >= len || (src[pos] as Unit) != 58 { Fail("expected ':' after a block mapping key"); }
          pos := pos + 1;
          if isExplicit {
            value := ParseExplicitValue(col);
          } else {
            SkipInlineSpaces();
            if pos < len && (src[pos] as Unit) != 10 && (src[pos] as Unit) != 13 && (src[pos] as Unit) != 35 {
              inlineMapValue := true;
              value := ParseBlockNode(col, true);
            } else {
              NextLine();
              if pos < len && (((pos - lineStart) as Counter) > col || (((pos - lineStart) as Counter) == col && (src[pos] as Unit) == 45)) { value := ParseBlockValue(col, true); }
            }
          }
        }
        StoreKey(result, key, value);
        hasValue := true;
        isExplicit := false;
        var atDocumentMarker := false;
        if pos < len && (pos - lineStart) as Counter == 0 { atDocumentMarker := IsDocMarkerAt(pos); }
        if atDocumentMarker {
          PublishRecordKeys(expected, hasExpected, produced, matched, keyCount, expectedLength);
          return;
        }
        if pos >= len || ((pos - lineStart) as Counter) != col {
          PublishRecordKeys(expected, hasExpected, produced, matched, keyCount, expectedLength);
          return;
        }
        if (src[pos] as Unit) == 45 {
          var dashSeparator: bool;
          dashSeparator := IsSpaceOrEolAt(pos + 1);
          if dashSeparator { PublishRecordKeys(expected, hasExpected, produced, matched, keyCount, expectedLength); return; }
        }
        if strict { CheckNoTabIndent(col - 1); }
        var fast := false;
        if matched && hasExpected && keyCount < expectedLength && !hasPendingAnchorName {
          var expectedValue: Value;
          expectedValue := ArrayGet(expected, keyCount);
          var expectedKey := StringValueOf(expectedValue);
          fast := FastMatchBlockKey(expectedKey);
          if fast { key := expectedKey; }
        }
        if !fast {
          var explicitIndicator := false;
          var emptyIndicator := false;
          if pos < len && (src[pos] as Unit) == 63 { explicitIndicator := IsSpaceOrEolAt(pos + 1); }
          if pos < len && (src[pos] as Unit) == 58 { emptyIndicator := IsSpaceOrEolAt(pos + 1); }
          if explicitIndicator {
            pos := pos + 1;
            var explicitKey := ParseExplicitKey(col);
            var explicitKeyText: string;
            explicitKeyText := KeyToString(explicitKey);
            key := InternKey(explicitKeyText);
            hasValue := ExplicitPairHasValue(col);
            isExplicit := true;
          } else if emptyIndicator {
            key := InternKey("");
            hasValue := true;
            isExplicit := false;
          } else {
            key := ParseBlockMapKey();
            hasValue := true;
            isExplicit := false;
          }
        }
      }
    }

    method ParseSingle() returns (value: Value)
    {
      var present: bool;
      present, value := ParseNextDocument();
      if !present { value := Null; return; }
      var another: bool;
      var ignored: Value;
      another, ignored := ParseNextDocument();
      if another { Fail("expected a single document in the stream, but found more (use parseAll for multi-document streams)"); }
    }

    method ParseAll() returns (documents: Value)
    {
      documents := CreateArray();
      var present: bool;
      var value: Value;
      present, value := ParseNextDocument();
      while present
        invariant true
      {
        ArrayPush(documents, value);
        present, value := ParseNextDocument();
      }
    }

    method EndStream()
    {
      valueCache := Undefined;
      hasValueCache := false;
      valueCacheEnabled := false;
      strict := false;
      keyCacheMaxBytes := NumberValue(4194304);
    }

    method IsDocMarkerAt(i: Index) returns (yes: bool)
      requires i <= len
      requires len as int == |src|
      requires i != lineStart || (i as int) + 2 < 9007199254740000
      ensures yes == DocumentMarkerAt(src, lineStart as int, i as int)
    {
      yes := false;
      if i != lineStart || i + 2 >= len { return; }
      var c := src[i] as Unit;
      if c != 45 && c != 46 { return; }
      if (src[i + 1] as Unit) != c || (src[i + 2] as Unit) != c { return; }
      var sep: bool;
      sep := IsSpaceOrEolAt(i + 3);
      yes := sep;
    }

    method ConsumeDocStartMarker() returns (inline: bool)
    {
      pos := pos + 3;
      SkipInlineSpaces();
      if pos >= len || (src[pos] as Unit) == 10 || (src[pos] as Unit) == 13 || (src[pos] as Unit) == 35 {
        NextLine();
        inline := false;
        return;
      }
      inline := true;
    }

    method ConsumeDocEndMarker()
    {
      pos := pos + 3;
      NextLine();
    }

    method ParseNextDocument() returns (present: bool, value: Value)
    {
      SkipBlankLines();
      if pos >= len { present := false; value := NoDocument; return; }
      var sawDirectives: bool;
      sawDirectives := ParseDirectives();
      if sawDirectives && !bareDocAllowed { Fail("a directives block must be preceded by an explicit '...' document end marker"); }
      SkipBlankLines();
      if pos >= len {
        if sawDirectives { Fail("a directives block must be terminated by an explicit '---' document start"); }
        present := false;
        value := NoDocument;
        return;
      }
      var marker: bool;
      marker := IsDocMarkerAt(pos);
      var isDash := marker && (src[pos] as Unit) == 45;
      if sawDirectives && !isDash { Fail("a directives block must be terminated by an explicit '---' document start"); }
      if marker {
        if (src[pos] as Unit) == 46 {
          value := Null;
          ConsumeDocEndMarker();
          bareDocAllowed := true;
          present := true;
          return;
        }
        var inline: bool;
        inline := ConsumeDocStartMarker();
        if pos >= len { value := Null; }
        else {
          var nextMarker: bool;
          nextMarker := IsDocMarkerAt(pos);
          if nextMarker { value := Null; }
          else if inline { value := ParseRootBlockNode(-2); }
          else { value := ParseRootBlockNode(-1); }
        }
      } else {
        if !bareDocAllowed { Fail("expected a '---' before the next document (a bare document may only follow an explicit '...')"); }
        value := ParseRootBlockNode(-1);
      }
      marker := IsDocMarkerAt(pos);
      if marker && (src[pos] as Unit) == 46 {
        ConsumeDocEndMarker();
        bareDocAllowed := true;
      } else { bareDocAllowed := false; }
      present := true;
    }
  }

  method Parse(text: string, isStrict: bool) returns (value: Value)
    requires |text| < 9007199254740000
  {
    var engine := new Engine();
    engine.Reset(text, isStrict, false, NumberValue(4194304));
    value := engine.ParseSingle();
  }

  method ParseAll(text: string, isStrict: bool) returns (documents: Value)
    requires |text| < 9007199254740000
  {
    var engine := new Engine();
    engine.Reset(text, isStrict, false, NumberValue(4194304));
    documents := engine.ParseAll();
  }
}
