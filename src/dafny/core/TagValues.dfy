module TagValues {
  import opened Native

  const BASE64_PADDING: Counter := 61
  const SPACE: Counter := 32
  const TAB: Counter := 9
  const LF: Counter := 10
  const CR: Counter := 13

  class Helpers {
    var lastError: string
    var base64Inv: Value

    constructor ()
    {
      new;
      lastError := "";
      base64Inv := CreateUint8Array(256);
      var i: Index := 0;
      while i < 256 {
        ByteSet(base64Inv, i, 255 as Unit);
        i := i + 1;
      }
      i := 0;
      while i < 26 {
        ByteSet(base64Inv, i + 65, i as Unit);
        ByteSet(base64Inv, i + 97, (i + 26) as Unit);
        i := i + 1;
      }
      i := 0;
      while i < 10 {
        ByteSet(base64Inv, i + 48, (i + 52) as Unit);
        i := i + 1;
      }
      ByteSet(base64Inv, 43, 62 as Unit);
      ByteSet(base64Inv, 47, 63 as Unit);
    }

    method ErrorMessage() returns (error: string)
    {
      error := lastError;
    }

    method BASE64_INV(code: Counter) returns (digit: Counter)
    {
      digit := -1;
      if code < 0 || code >= 256 { return; }
      var value := ByteGet(base64Inv, code as Index) as Counter;
      if value != 255 { digit := value; }
    }

    method IsBase64Whitespace(code: Counter) returns (yes: bool)
    {
      yes := code == SPACE || code == TAB || code == LF || code == CR;
    }

    method StripBase64Whitespace(raw: string) returns (clean: string)
    {
      var n := StringLength(raw);
      var hasWs := false;
      var i: Index := 0;
      while i < n {
        var c := CodeUnitAt(raw, i);
        var isWs := IsBase64Whitespace(c);
        if isWs { hasWs := true; break; }
        i := i + 1;
      }
      if !hasWs { clean := raw; return; }
      clean := "";
      var seg: Index := 0;
      i := 0;
      while i <= n {
        var c: Counter := -1;
        if i < n { c := CodeUnitAt(raw, i); }
        var isWs := IsBase64Whitespace(c);
        if isWs || c == -1 {
          if i > seg { clean := Concat(clean, Slice(raw, seg, i)); }
          seg := i + 1;
        }
        i := i + 1;
      }
    }

    method DecodeBinary(raw: string) returns (bytes: Value)
    {
      bytes := Undefined;
      lastError := "";
      var clean := StripBase64Whitespace(raw);
      var n := StringLength(clean);
      if n == 0 {
        bytes := CreateUint8Array(0);
        return;
      }
      if n % 4 != 0 {
        lastError := "malformed !!binary content: base64 length must be a multiple of 4 after stripping whitespace";
        return;
      }
      var padding: Counter := 0;
      var last := CodeUnitAt(clean, n - 1);
      if last == BASE64_PADDING {
        padding := 1;
        var previous := CodeUnitAt(clean, n - 2);
        if previous == BASE64_PADDING { padding := 2; }
      }
      var validEnd := (n as Counter) - padding;
      var i: Index := 0;
      while (i as Counter) < validEnd {
        var code := CodeUnitAt(clean, i);
        var digit := BASE64_INV(code);
        if code >= 256 || digit == -1 {
          lastError := "malformed !!binary content: invalid base64 character";
          return;
        }
        i := i + 1;
      }
      var outLen := ((n as Counter) / 4) * 3 - padding;
      bytes := CreateUint8Array(outLen as Index);
      var o: Index := 0;
      i := 0;
      while i < n {
        var c0Code := CodeUnitAt(clean, i);
        var c1Code := CodeUnitAt(clean, i + 1);
        var c2Code := CodeUnitAt(clean, i + 2);
        var c3Code := CodeUnitAt(clean, i + 3);
        var c0 := BASE64_INV(c0Code);
        var c1 := BASE64_INV(c1Code);
        var c2: Counter := 0;
        if c2Code != BASE64_PADDING { c2 := BASE64_INV(c2Code); }
        var c3: Counter := 0;
        if c3Code != BASE64_PADDING { c3 := BASE64_INV(c3Code); }
        var triple := c0 * 262144 + c1 * 4096 + c2 * 64 + c3;
        var isLastGroup := i + 4 == n;
        var firstByte := (triple / 65536) as Unit;
        ByteSet(bytes, o, firstByte);
        o := o + 1;
        if !(isLastGroup && padding >= 2) {
          var secondByte := ((triple / 256) % 256) as Unit;
          ByteSet(bytes, o, secondByte);
          o := o + 1;
        }
        if !(isLastGroup && padding >= 1) {
          var thirdByte := (triple % 256) as Unit;
          ByteSet(bytes, o, thirdByte);
          o := o + 1;
        }
        i := i + 4;
      }
    }

    method BuildSet(mapValue: Value) returns (setValue: Value)
    {
      setValue := Undefined;
      lastError := "";
      var nativeSet := SetCreate();
      var keys := ObjectKeys(mapValue);
      var n := ArrayLength(keys);
      var i: Index := 0;
      while i < n {
        var keyValue := ArrayGet(keys, i);
        var key := StringValueOf(keyValue);
        var value := ObjectGet(mapValue, key);
        if !IsNull(value) {
          lastError := "!!set: every key must have a null value";
          return;
        }
        SetAdd(nativeSet, keyValue);
        i := i + 1;
      }
      setValue := SetValue(nativeSet);
    }

    method BuildOmap(sequence: Value) returns (mapValue: Value)
    {
      mapValue := Undefined;
      lastError := "";
      var nativeMap := MapCreate();
      var n := ArrayLength(sequence);
      var i: Index := 0;
      while i < n {
        var entry := ArrayGet(sequence, i);
        var keys := SinglePairKeys(entry);
        if lastError != "" { return; }
        var keyValue := ArrayGet(keys, 0);
        var key := StringValueOf(keyValue);
        var value := ObjectGet(entry, key);
        MapSet(nativeMap, keyValue, value);
        i := i + 1;
        n := ArrayLength(sequence);
      }
      mapValue := MapValue(nativeMap);
    }

    method ValidatePairs(sequence: Value)
    {
      lastError := "";
      var n := ArrayLength(sequence);
      var i: Index := 0;
      while i < n {
        var entry := ArrayGet(sequence, i);
        var keys := SinglePairKeys(entry);
        if lastError != "" { return; }
        i := i + 1;
        n := ArrayLength(sequence);
      }
    }

    method SinglePairKeys(entry: Value) returns (keys: Value)
    {
      keys := Undefined;
      lastError := "";
      if !IsObject(entry) || IsNull(entry) || IsArray(entry) {
        lastError := "each entry must be a single-key mapping ('- key: value')";
        return;
      }
      keys := ObjectKeys(entry);
      var n := ArrayLength(keys);
      if n != 1 {
        lastError := "each entry must have exactly one key (one sequence indicator per pair)";
        keys := Undefined;
        return;
      }
    }
  }
}
