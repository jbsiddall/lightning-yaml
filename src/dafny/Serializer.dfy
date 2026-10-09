module Serializer {
  import opened Native

  const MAX_DEPTH: Counter := 1000
  const INDENT_STEP: Index := 2
  const MAX_DUMP_KEY_CACHE: Index := 10000
  const SPACE: Counter := 32
  const DQUOTE: Counter := 34
  const SQUOTE: Counter := 39
  const MINUS: Counter := 45
  const ZERO: Counter := 48
  const PLUS: Counter := 43
  const DOT: Counter := 46
  const LOWER_E: Counter := 101
  const UPPER_E: Counter := 69
  const BACKSLASH: Counter := 92
  const TAB: Counter := 9
  const LF: Counter := 10
  const CR: Counter := 13
  const HASH: Counter := 35
  const COMMA: Counter := 44
  const LBRACKET: Counter := 91
  const RBRACKET: Counter := 93
  const LBRACE: Counter := 123
  const RBRACE: Counter := 125
  const QUESTION: Counter := 63
  const COLON: Counter := 58
  const AMP: Counter := 38
  const STAR: Counter := 42
  const EXCLAIM: Counter := 33
  const PIPE: Counter := 124
  const GT: Counter := 62
  const PERCENT: Counter := 37
  const AT: Counter := 64
  const BACKTICK: Counter := 96
  const HEX: string := "0123456789ABCDEF"
  const ALPHABET: string := "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

  class Writer {
    var indentCache: Value
    var dumpRefCounts: Map
    var dumpAnchors: Map
    var dumpAnchorSeq: Counter
    var dumpDepth: Counter
    var dumpKeyCache: Map
    var dumpHasShared: bool
    var out: string
    var dumpFlattenSink: Counter

    constructor ()
    {
      new;
      indentCache := CreateArray();
      dumpRefCounts := MapCreate();
      dumpAnchors := MapCreate();
      dumpKeyCache := MapCreate();
      dumpAnchorSeq := 0;
      dumpDepth := 0;
      dumpHasShared := false;
      out := "";
      dumpFlattenSink := 0;
      ArrayPush(indentCache, StringValue(""));
    }

    method IndentSpaces(n: Index) returns (spaces: string)
    {
      var length := ArrayLength(indentCache);
      while length <= n
      {
        var last := length - 1;
        var previousValue := ArrayGet(indentCache, last);
        var previous := StringValueOf(previousValue);
        var next := Concat(previous, " ");
        ArrayPush(indentCache, StringValue(next));
        length := length + 1;
      }
      var result := ArrayGet(indentCache, n);
      spaces := StringValueOf(result);
    }

    method DumpScanRefs(value: Value)
    {
      if !IsObject(value) || IsNull(value) { return; }
      var present := MapHas(dumpRefCounts, value);
      if present {
        var oldValue := MapGet(dumpRefCounts, value);
        var oldCount := NumberAsCounter(oldValue);
        MapSet(dumpRefCounts, value, NumberValue(oldCount + 1));
        dumpHasShared := true;
        return;
      }
      MapSet(dumpRefCounts, value, NumberValue(1));
      if IsUint8Array(value) { return; }
      dumpDepth := dumpDepth + 1;
      if dumpDepth > MAX_DEPTH { Fail("stringify: maximum nesting depth exceeded"); }
      if IsArray(value) {
        var i: Index := 0;
        var n := ArrayLength(value);
        while i < n {
          var child := ArrayGet(value, i);
          DumpScanRefs(child);
          i := i + 1;
        }
      } else {
        var keys := ObjectKeys(value);
        var i: Index := 0;
        var n := ArrayLength(keys);
        while i < n {
          var keyValue := ArrayGet(keys, i);
          var key := StringValueOf(keyValue);
          var child := ObjectGet(value, key);
          DumpScanRefs(child);
          i := i + 1;
        }
      }
      dumpDepth := dumpDepth - 1;
    }

    method DumpNeedsAnchor(obj: Value) returns (needs: bool)
    {
      var refCount := MapGet(dumpRefCounts, obj);
      needs := NumberAsCounter(refCount) > 1;
    }

    method DumpAssignAnchor(obj: Value) returns (name: string)
    {
      dumpAnchorSeq := dumpAnchorSeq + 1;
      var sequence := FormatCounter(dumpAnchorSeq);
      name := Concat("a", sequence);
      MapSet(dumpAnchors, obj, StringValue(name));
    }

    function IsPlainLeadingIndicator(c: Counter): bool
    {
      c == MINUS || c == QUESTION || c == COLON || c == COMMA ||
      c == LBRACKET || c == RBRACKET || c == LBRACE || c == RBRACE ||
      c == HASH || c == AMP || c == STAR || c == EXCLAIM || c == PIPE ||
      c == GT || c == SQUOTE || c == DQUOTE || c == PERCENT || c == AT || c == BACKTICK
    }

    method LooksLikeTypedScalar(s: string) returns (typed: bool)
    {
      typed := s == "~" || s == "null" || s == "Null" || s == "NULL" ||
        s == "true" || s == "True" || s == "TRUE" ||
        s == "false" || s == "False" || s == "FALSE";
      if typed { return; }
      typed := TryNumberGeneric(s);
    }

    method TryNumberGeneric(s: string) returns (valid: bool)
    {
      var end := StringLength(s);
      var p: Index := 0;
      var c: Counter := -1;
      if end > 0 { c := CodeUnitAt(s, 0); }
      var neg := c == MINUS;
      var signed := neg || c == PLUS;
      if signed {
        p := 1;
        if p >= end { valid := false; return; }
        c := CodeUnitAt(s, p);
      }
      if !signed && c == ZERO && p + 1 < end {
        var n2 := CodeUnitAt(s, p + 1);
        if n2 == 120 {
          valid := HexDigits(s, p + 2, end);
          return;
        }
        if n2 == 111 {
          valid := OctalDigits(s, p + 2, end);
          return;
        }
      }
      if c == DOT && end - p == 4 {
        var a := CodeUnitAt(s, p + 1);
        var b := CodeUnitAt(s, p + 2);
        var d := CodeUnitAt(s, p + 3);
        if IsInfWord(a, b, d) { valid := true; return; }
        if !signed && IsNanWord(a, b, d) { valid := true; return; }
      }
      var nd: Counter := 0;
      while p < end {
        var d := CodeUnitAt(s, p) - ZERO;
        if d < 0 || d > 9 { break; }
        nd := nd + 1;
        p := p + 1;
      }
      if p < end && CodeUnitAt(s, p) == DOT {
        p := p + 1;
        while p < end {
          var d := CodeUnitAt(s, p) - ZERO;
          if d < 0 || d > 9 { break; }
          nd := nd + 1;
          p := p + 1;
        }
      }
      if nd == 0 { valid := false; return; }
      if p < end && (CodeUnitAt(s, p) == LOWER_E || CodeUnitAt(s, p) == UPPER_E) {
        p := p + 1;
        if p < end && (CodeUnitAt(s, p) == PLUS || CodeUnitAt(s, p) == MINUS) { p := p + 1; }
        var expStart := p;
        while p < end {
          var d := CodeUnitAt(s, p) - ZERO;
          if d < 0 || d > 9 { break; }
          p := p + 1;
        }
        if p == expStart { valid := false; return; }
      }
      valid := p == end;
    }

    method HexDigits(s: string, from: Index, end: Index) returns (valid: bool)
    {
      if from >= end { valid := false; return; }
      var p := from;
      while p < end {
        var c := CodeUnitAt(s, p);
        if !((c >= ZERO && c <= ZERO + 9) || (c >= 97 && c <= 102) || (c >= 65 && c <= 70)) {
          valid := false;
          return;
        }
        p := p + 1;
      }
      valid := true;
    }

    method OctalDigits(s: string, from: Index, end: Index) returns (valid: bool)
    {
      if from >= end { valid := false; return; }
      var p := from;
      while p < end {
        var c := CodeUnitAt(s, p);
        if c < ZERO || c > 55 { valid := false; return; }
        p := p + 1;
      }
      valid := true;
    }

    function IsInfWord(a: Counter, b: Counter, c: Counter): bool
    {
      (a == 105 && b == 110 && c == 102) || (a == 73 && b == 110 && c == 102) ||
      (a == 73 && b == 78 && c == 70)
    }

    function IsNanWord(a: Counter, b: Counter, c: Counter): bool
    {
      (a == 110 && b == 97 && c == 110) || (a == 78 && b == 97 && c == 78) ||
      (a == 78 && b == 65 && c == 78)
    }

    method IsPlainScalarSafe(s: string) returns (safe: bool)
    {
      var n := StringLength(s);
      if n == 0 { safe := false; return; }
      var c0 := CodeUnitAt(s, 0);
      if c0 == SPACE || IsPlainLeadingIndicator(c0) { safe := false; return; }
      var cLast := CodeUnitAt(s, n - 1);
      if cLast == SPACE || cLast == COLON { safe := false; return; }
      var i: Index := 0;
      while i < n {
        var c := CodeUnitAt(s, i);
        if c < 32 || c == 127 { safe := false; return; }
        if c == COLON && i + 1 < n && CodeUnitAt(s, i + 1) == SPACE { safe := false; return; }
        if c == SPACE && i + 1 < n && CodeUnitAt(s, i + 1) == HASH { safe := false; return; }
        i := i + 1;
      }
      var typed := LooksLikeTypedScalar(s);
      safe := !typed;
    }

    method NeedsDoubleQuoting(s: string) returns (needs: bool)
    {
      var i: Index := 0;
      var n := StringLength(s);
      while i < n {
        var c := CodeUnitAt(s, i);
        if c < 32 || c == 127 { needs := true; return; }
        i := i + 1;
      }
      needs := false;
    }

    method EncodeSingleQuoted(s: string) returns (encoded: string)
    {
      var parts := CreateArray();
      ArrayPush(parts, StringValue("'"));
      var seg: Index := 0;
      var i: Index := 0;
      var n := StringLength(s);
      while i < n {
        if CodeUnitAt(s, i) == SQUOTE {
          ArrayPush(parts, StringValue(Slice(s, seg, i)));
          ArrayPush(parts, StringValue("''"));
          seg := i + 1;
        }
        i := i + 1;
      }
      ArrayPush(parts, StringValue(Slice(s, seg, n)));
      ArrayPush(parts, StringValue("'"));
      encoded := Join(parts, "");
    }

    method HexEscape(c: Counter) returns (escaped: string)
    {
      var hi := c / 16;
      var lo := c % 16;
      var digit := Slice(HEX, hi as Index, (hi + 1) as Index);
      var last := Slice(HEX, lo as Index, (lo + 1) as Index);
      if c < 16 { escaped := Concat("\\x0", last); }
      else { escaped := Concat("\\x", Concat(digit, last)); }
    }

    method EncodeDoubleQuoted(s: string) returns (encoded: string)
    {
      var parts := CreateArray();
      ArrayPush(parts, StringValue("\""));
      var seg: Index := 0;
      var i: Index := 0;
      var n := StringLength(s);
      while i < n {
        var c := CodeUnitAt(s, i);
        var esc := "";
        var found := true;
        if c == BACKSLASH { esc := "\\\\"; }
        else if c == DQUOTE { esc := "\\\""; }
        else if c == 0 { esc := "\\0"; }
        else if c == 7 { esc := "\\a"; }
        else if c == 8 { esc := "\\b"; }
        else if c == 9 { esc := "\\t"; }
        else if c == 10 { esc := "\\n"; }
        else if c == 11 { esc := "\\v"; }
        else if c == 12 { esc := "\\f"; }
        else if c == 13 { esc := "\\r"; }
        else if c == 27 { esc := "\\e"; }
        else if c < 32 || c == 127 { esc := HexEscape(c); }
        else { found := false; }
        if found {
          if i > seg { ArrayPush(parts, StringValue(Slice(s, seg, i))); }
          ArrayPush(parts, StringValue(esc));
          seg := i + 1;
        }
        i := i + 1;
      }
      ArrayPush(parts, StringValue(Slice(s, seg, n)));
      ArrayPush(parts, StringValue("\""));
      encoded := Join(parts, "");
    }

    method WriteStringScalar(s: string) returns (rendered: string)
    {
      var safe := IsPlainScalarSafe(s);
      if safe { rendered := s; return; }
      var needsDouble := NeedsDoubleQuoting(s);
      if needsDouble { rendered := EncodeDoubleQuoted(s); }
      else { rendered := EncodeSingleQuoted(s); }
    }

    method WriteRootStringScalar(s: string) returns (rendered: string)
    {
      if s == "..." || (StringLength(s) >= 4 && Slice(s, 0, 4) == "... ") {
        var needsDouble := NeedsDoubleQuoting(s);
        if needsDouble { rendered := EncodeDoubleQuoted(s); }
        else { rendered := EncodeSingleQuoted(s); }
        return;
      }
      rendered := WriteStringScalar(s);
    }

    method FormatCounter(n: Counter) returns (text: string)
    {
      text := FormatNumber(NumberValue(n));
    }

    method FormatNumberValue(v: Value) returns (text: string)
    {
      if NumberIsNaN(v) { text := ".nan"; return; }
      if NumberIsPositiveInfinity(v) { text := ".inf"; return; }
      if NumberIsNegativeInfinity(v) { text := "-.inf"; return; }
      if NumberIsNegativeZero(v) { text := "-0"; return; }
      text := FormatNumber(v);
    }

    method WriteScalar(value: Value) returns (text: string)
    {
      if IsNull(value) || IsUndefined(value) { text := "null"; return; }
      if IsBoolean(value) {
        if BooleanValue(value) { text := "true"; } else { text := "false"; }
        return;
      }
      if IsNumber(value) { text := FormatNumberValue(value); return; }
      if IsString(value) { text := WriteStringScalar(StringValueOf(value)); return; }
      var fallback := StringFallback(value);
      text := WriteStringScalar(fallback);
    }

    method EncodeBase64(bytes: Value) returns (encoded: string)
    {
      var n := ByteLength(bytes);
      if n == 0 { encoded := ""; return; }
      var parts := CreateArray();
      var i: Index := 0;
      while i + 3 <= n {
        var b0 := ByteGet(bytes, i) as Counter;
        var b1 := ByteGet(bytes, i + 1) as Counter;
        var b2 := ByteGet(bytes, i + 2) as Counter;
        var triple := b0 * 65536 + b1 * 256 + b2;
        var a := (triple / 262144) as Index;
        var b := ((triple / 4096) % 64) as Index;
        var c := ((triple / 64) % 64) as Index;
        var d := (triple % 64) as Index;
        ArrayPush(parts, StringValue(Slice(ALPHABET, a, a + 1)));
        ArrayPush(parts, StringValue(Slice(ALPHABET, b, b + 1)));
        ArrayPush(parts, StringValue(Slice(ALPHABET, c, c + 1)));
        ArrayPush(parts, StringValue(Slice(ALPHABET, d, d + 1)));
        i := i + 3;
      }
      var rem := n - i;
      if rem == 1 {
        var triple := (ByteGet(bytes, i) as Counter) * 65536;
        var a := (triple / 262144) as Index;
        var b := ((triple / 4096) % 64) as Index;
        ArrayPush(parts, StringValue(Slice(ALPHABET, a, a + 1)));
        ArrayPush(parts, StringValue(Slice(ALPHABET, b, b + 1)));
        ArrayPush(parts, StringValue("="));
        ArrayPush(parts, StringValue("="));
      } else if rem == 2 {
        var triple := (ByteGet(bytes, i) as Counter) * 65536 + (ByteGet(bytes, i + 1) as Counter) * 256;
        var a := (triple / 262144) as Index;
        var b := ((triple / 4096) % 64) as Index;
        var c := ((triple / 64) % 64) as Index;
        ArrayPush(parts, StringValue(Slice(ALPHABET, a, a + 1)));
        ArrayPush(parts, StringValue(Slice(ALPHABET, b, b + 1)));
        ArrayPush(parts, StringValue(Slice(ALPHABET, c, c + 1)));
        ArrayPush(parts, StringValue("="));
      }
      encoded := Join(parts, "");
    }

    method WriteBinaryScalar(bytes: Value) returns (text: string)
    {
      var b64 := EncodeBase64(bytes);
      if b64 == "" { text := "!!binary \"\""; }
      else { text := Concat("!!binary ", b64); }
    }

    method IsEmptyContainer(obj: Value, isArr: bool) returns (empty: bool)
    {
      if isArr {
        var count := ArrayLength(obj);
        empty := count == 0;
      }
      else {
        var keys := ObjectKeys(obj);
        var count := ArrayLength(keys);
        empty := count == 0;
      }
    }

    method WriteCollectionBody(obj: Value, isArr: bool, indent: Index)
    {
      dumpDepth := dumpDepth + 1;
      if dumpDepth > MAX_DEPTH { Fail("stringify: maximum nesting depth exceeded"); }
      var ind := IndentSpaces(indent);
      if isArr {
        var i: Index := 0;
        var n := ArrayLength(obj);
        while i < n {
          out := Concat(out, Concat(ind, "-"));
          var value := ArrayGet(obj, i);
          WriteEntryValue(value, indent);
          i := i + 1;
        }
      } else {
        var keys := ObjectKeys(obj);
        var i: Index := 0;
        var n := ArrayLength(keys);
        while i < n {
          var keyValue := ArrayGet(keys, i);
          var k := StringValueOf(keyValue);
          keyValue := StringValue(k);
          var keyColon := "";
          var cached := MapHas(dumpKeyCache, keyValue);
          if cached {
            var cacheValue := MapGet(dumpKeyCache, keyValue);
            keyColon := StringValueOf(cacheValue);
          } else {
            var rendered := WriteStringScalar(k);
            keyColon := Concat(rendered, ":");
            var cacheSize := MapSize(dumpKeyCache);
            if cacheSize < MAX_DUMP_KEY_CACHE {
              MapSet(dumpKeyCache, keyValue, StringValue(keyColon));
            }
          }
          out := Concat(out, Concat(ind, keyColon));
          var value := ObjectGet(obj, k);
          WriteEntryValue(value, indent);
          i := i + 1;
        }
      }
      dumpDepth := dumpDepth - 1;
    }

    method WriteEntryValue(value: Value, indent: Index)
    {
      if !IsObject(value) || IsNull(value) {
        var scalar := WriteScalar(value);
        out := Concat(out, Concat(" ", Concat(scalar, "\n")));
        return;
      }
      var hasExistingAnchor := false;
      if dumpHasShared { hasExistingAnchor := MapHas(dumpAnchors, value); }
      if hasExistingAnchor {
        var anchorValue := MapGet(dumpAnchors, value);
        var already := StringValueOf(anchorValue);
        out := Concat(out, Concat(" *", Concat(already, "\n")));
        return;
      }
      if IsUint8Array(value) {
        var hasName := false;
        if dumpHasShared { hasName := DumpNeedsAnchor(value); }
        var name := "";
        if hasName { name := DumpAssignAnchor(value); }
        var binary := WriteBinaryScalar(value);
        if hasName { binary := Concat("&", Concat(name, Concat(" ", binary))); }
        out := Concat(out, Concat(" ", Concat(binary, "\n")));
        return;
      }
      var isArr := IsArray(value);
      var hasName := false;
      if dumpHasShared { hasName := DumpNeedsAnchor(value); }
      var name := "";
      if hasName { name := DumpAssignAnchor(value); }
      var empty := IsEmptyContainer(value, isArr);
      if empty {
        var literal := if isArr then "[]" else "{}";
        if hasName { literal := Concat("&", Concat(name, Concat(" ", literal))); }
        out := Concat(out, Concat(" ", Concat(literal, "\n")));
        return;
      }
      if hasName { out := Concat(out, Concat(" &", Concat(name, "\n"))); }
      else { out := Concat(out, "\n"); }
      WriteCollectionBody(value, isArr, indent + INDENT_STEP);
    }

    method WriteDocumentValue(value: Value)
    {
      if !IsObject(value) || IsNull(value) {
        var scalar := "";
        if IsString(value) {
          var stringValue := StringValueOf(value);
          scalar := WriteRootStringScalar(stringValue);
        } else {
          scalar := WriteScalar(value);
        }
        out := Concat(out, Concat(scalar, "\n"));
        return;
      }
      if IsUint8Array(value) {
        var hasName := false;
        if dumpHasShared { hasName := DumpNeedsAnchor(value); }
        var name := "";
        if hasName { name := DumpAssignAnchor(value); }
        var binary := WriteBinaryScalar(value);
        if hasName { binary := Concat("&", Concat(name, Concat(" ", binary))); }
        out := Concat(out, Concat(binary, "\n"));
        return;
      }
      var isArr := IsArray(value);
      var hasName := false;
      if dumpHasShared { hasName := DumpNeedsAnchor(value); }
      var name := "";
      if hasName { name := DumpAssignAnchor(value); }
      var empty := IsEmptyContainer(value, isArr);
      if empty {
        var literal := if isArr then "[]" else "{}";
        if hasName { literal := Concat("&", Concat(name, Concat(" ", literal))); }
        out := Concat(out, Concat(literal, "\n"));
        return;
      }
      if hasName { out := Concat(out, Concat("&", Concat(name, "\n"))); }
      WriteCollectionBody(value, isArr, 0);
    }

    method DumpFinish() returns (result: string)
    {
      result := out;
      out := "";
      if StringLength(result) != 0 { dumpFlattenSink := dumpFlattenSink + CodeUnitAt(result, 0); }
      dumpRefCounts := MapCreate();
      dumpAnchors := MapCreate();
      dumpKeyCache := MapCreate();
    }

    method Stringify(value: Value) returns (text: string)
    {
      dumpKeyCache := MapCreate();
      dumpRefCounts := MapCreate();
      dumpDepth := 0;
      dumpHasShared := false;
      DumpScanRefs(value);
      if !dumpHasShared { dumpRefCounts := MapCreate(); }
      dumpAnchors := MapCreate();
      dumpAnchorSeq := 0;
      out := "";
      dumpDepth := 0;
      WriteDocumentValue(value);
      text := DumpFinish();
    }
  }
}
