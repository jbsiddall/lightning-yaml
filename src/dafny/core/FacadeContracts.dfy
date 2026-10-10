module FacadeContracts {
  import opened SurfaceModel
  import opened NativeContracts
  import opened ObjectsAndErrors
  import opened FacadeFlow
  import opened ErrorTranslation

  ghost predicate Inputs(v: map<Handle, Value>, r: Realm,
      handles: seq<Handle>, es: seq<Event>) reads {} {
    RealmValues(v, r) && (forall h | h in handles :: ( h in v) ) &&
      TraceLinked(es) && TraceValues(v, es)
  }
  ghost function YamlSlot(v: map<Handle, Value>, second: Handle, third: Handle): Handle reads {}
    requires second in v && third in v
  {
    if !IsFunction(v[second]) && Truthy(v[second]) && v[third].UndefinedValue?
      then ( second ) else ( third
  ) }
  ghost function JsSlot(v: map<Handle, Value>, second: Handle, third: Handle): Handle reads {}
    requires second in v && third in v
  {
    if IsNonNullObject(v[second]) then ( second ) else ( third
  ) }
  ghost predicate ReviveRoot(v: map<Handle, Value>, r: Realm,
      value: Handle, callback: Handle, es: seq<Event>, out: Outcome) reads {} {
    |es| > 0 &&
    var props := [Property("", value, true, true, true)];
    es[0].operation == AllocateRecord(props, r.objectPrototype, []) &&
    (if es[0].outcome.Thrown? then ( |es| == 1 && out == es[0].outcome
     ) else ( RecordAllocated(v, es[0], props, r.objectPrototype, []) &&
       ReviveProperty(v, es[0].outcome.value, "", callback, r.undefined, es[1..], out)) )
  }
  ghost predicate YamlParse(v: map<Handle, Value>, r: Realm,
      text: Handle, second: Handle, third: Handle, es: seq<Event>, out: Outcome) reads {} {
    Inputs(v, r, [text, second, third], es) &&
    exists n: int, checked: Outcome :: ( 0 <= n <= |es| &&
      ValidateOptions(v, YamlRead, YamlSlot(v, second, third), r.coreIdentity, r.undefined, es[..n], checked) &&
      (if checked.Thrown? then ( n == |es| && out == checked
       ) else ( exists m: int, parsed: Outcome :: (
         NativeParseSlice(v, r, text, false, es, n, m, parsed) &&
         (if parsed.Thrown? || !IsFunction(v[second]) then ( n+m == |es| && out == parsed
          ) else ( ReviveRoot(v, r, parsed.value, second, es[n+m..], out)) )) ) )
  ) }
  ghost predicate JsParse(v: map<Handle, Value>, r: Realm,
      text: Handle, options: Handle, all: bool, es: seq<Event>, out: Outcome) reads {} {
    Inputs(v, r, [text, options], es) &&
    exists n: int, checked: Outcome :: ( 0 <= n <= |es| &&
      ValidateOptions(v, JsLoad, options, r.coreIdentity, r.undefined, es[..n], checked) &&
      (if checked.Thrown? then ( n == |es| && out == checked
       ) else ( exists m: int, parsed: Outcome :: (
         NativeParseSlice(v, r, text, all, es, n, m, parsed) &&
         (if parsed.Returned? then ( n+m == |es| && out == parsed
          ) else ( JsCaught(v, r, parsed.value, options, es[n+m..], out)) )) ) )
  ) }
  ghost predicate NativeParseSlice(v: map<Handle, Value>, r: Realm, text: Handle,
      all: bool, es: seq<Event>, start: int, count: int, parsed: Outcome) reads {} {
    0 <= start <= |es| && 0 < count <= |es|-start &&
    NativeParseCompletion(v, text, r.undefined, r.undefined, all, es[start..start+count], parsed)
  }
  ghost predicate SingleDocumentSlice(v: map<Handle, Value>, r: Realm, text: Handle,
      es: seq<Event>, start: int, count: int, attempted: Outcome) reads {} {
    0 <= start <= |es| && 0 < count <= |es|-start &&
    SingleDocumentTry(v, r, text, es[start..start+count], attempted)
  }
  ghost predicate AllDocumentsSlice(v: map<Handle, Value>, r: Realm, text: Handle,
      es: seq<Event>, start: int, count: int, attempted: Outcome) reads {} {
    0 <= start <= |es| && 0 < count <= |es|-start &&
    AllDocumentsTry(v, r, text, es[start..start+count], attempted)
  }
  ghost predicate FallbackSlice(v: map<Handle, Value>, r: Realm, text: Handle,
      es: seq<Event>, start: int, count: int, contents: Handle) reads {} {
    0 <= start <= |es| && 0 < count <= |es|-start &&
    FirstFallback(v, r, text, es[start..start+count], contents)
  }
  ghost predicate ErrorDocumentSlice(v: map<Handle, Value>, r: Realm, contents: Handle,
      err: Handle, es: seq<Event>, start: int, count: int, document: Outcome) reads {} {
    0 <= start <= |es| && 0 < count <= |es|-start &&
    ErrorDocument(v, r, contents, err, es[start..start+count], document)
  }
  ghost predicate JsLoadCompletion(v: map<Handle, Value>, r: Realm,
      text: Handle, options: Handle, es: seq<Event>, out: Outcome) reads {} {
    JsParse(v, r, text, options, false, es, out)
  }
  ghost predicate JsLoadAllCompletion(v: map<Handle, Value>, r: Realm,
      text: Handle, second: Handle, third: Handle, es: seq<Event>, out: Outcome) reads {} {
    Inputs(v, r, [text, second, third], es) &&
    exists n: int, parsed: Outcome :: ( 0 < n <= |es| &&
      JsParse(v, r, text, JsSlot(v, second, third), true, es[..n], parsed) &&
      (if parsed.Thrown? || !IsFunction(v[second]) then ( n == |es| && out == parsed
       ) else ( IterateDocuments(v, parsed.value, second, r.undefined, es[n..], out)) )
  ) }
  ghost predicate JsDumpCompletion(v: map<Handle, Value>, r: Realm,
      value: Handle, options: Handle, es: seq<Event>, out: Outcome) reads {} {
    Inputs(v, r, [value, options], es) &&
    exists n: int, checked: Outcome :: ( 0 <= n <= |es| &&
      ValidateOptions(v, JsDump, options, r.coreIdentity, r.undefined, es[..n], checked) &&
      (if checked.Thrown? then ( n == |es| && out == checked
       ) else ( NativeStringifyCompletion(v, value, es[n..], out)) )
  ) }
  ghost function TypeofText(value: Value): string reads {} {
    match value
    case UndefinedValue => "undefined"
    case NullValue => "object"
    case BooleanValue(_) => "boolean"
    case NumberValue(_) => "number"
    case StringValue(_) => "string"
    case BigIntValue(_) => "bigint"
    case SymbolValue(_) => "symbol"
    case ReferenceValue(_, kind) =>
      if kind == HtmlDdaReference then ( "undefined"
      ) else ( if kind == FunctionReference || kind == ClosureReference then ( "function" ) else ( "object"
  ) ) }
  ghost function PrimitiveOptionsMessage(value: Value): string reads {} {
    if value.NumberValue? || value.StringValue? then (
      "the JSON.stringify-style indent shorthand (stringify(value, replacer, indent)) is not supported yet — custom indent width is unimplemented"
    ) else ( "stringify options must be an object; received a " + TypeofText(value)
  ) }
  ghost predicate FailYaml(message: string, es: seq<Event>, out: Outcome) reads {} {
    ExactEvent(es, NewOptionError(YamlWrite, "lightning-yaml yaml compat: " + message), out) && out.Thrown?
  }
  ghost predicate YamlStringifyAfterArray(v: map<Handle, Value>, r: Realm,
      value: Handle, second: Handle, third: Handle, secondArray: bool,
      es: seq<Event>, out: Outcome) reads {}
    requires second in v && third in v
  {
    var replacer := IsFunction(v[second]) || secondArray;
    var slot := if !replacer && Truthy(v[second]) && v[third].UndefinedValue? then ( second ) else ( third) ;
    if !LooseNullish(v[slot]) && !IsNonNullObject(v[slot]) then (
      FailYaml(PrimitiveOptionsMessage(v[slot]), es, out)
    ) else ( exists n: int, checked: Outcome :: ( 0 <= n <= |es| &&
      ValidateOptions(v, YamlWrite, slot, r.coreIdentity, r.undefined, es[..n], checked) &&
      (if checked.Thrown? then ( n == |es| && out == checked
       ) else ( if replacer then ( FailYaml("a replacer is not supported yet — the ./yaml stringify replacer is tracked separately", es[n..], out)
       ) else ( NativeStringifyCompletion(v, value, es[n..], out)) ) )
  ) ) }
  ghost predicate YamlStringifyCompletion(v: map<Handle, Value>, r: Realm,
      value: Handle, second: Handle, third: Handle, es: seq<Event>, out: Outcome) reads {} {
    Inputs(v, r, [value, second, third], es) &&
    (if IsFunction(v[second]) then ( YamlStringifyAfterArray(v, r, value, second, third, false, es, out)
     ) else ( |es| > 0 && es[0].operation == CheckArray(second) &&
       (if es[0].outcome.Thrown? then ( |es| == 1 && out == es[0].outcome
        ) else ( exists isArray: bool :: ( ReturnedBoolean(v, es[0].outcome, isArray) &&
          YamlStringifyAfterArray(v, r, value, second, third, isArray, es[1..], out)) ) )) )
  }

  ghost predicate DefaultDocument(v: map<Handle, Value>, r: Realm,
      contents: Handle, es: seq<Event>, out: Outcome) reads {} {
    TraceLinked(es) && TraceValues(v, es) && |es| > 0 && es[0].operation == AllocateArray([]) &&
    (if es[0].outcome.Thrown? then ( |es| == 1 && out == es[0].outcome
     ) else ( ArrayAllocated(v, es[0], [], r.arrayPrototype) &&
       DocumentAllocation(v, contents, es[0].outcome.value, r.arrayPrototype,
         r.objectPrototype, r.functionPrototype, es[1..], out)) )
  }
  ghost predicate ErrorDocument(v: map<Handle, Value>, r: Realm,
      contents: Handle, err: Handle, es: seq<Event>, out: Outcome) reads {} {
    exists n: int, converted: Outcome :: ( 0 < n <= |es| &&
      ToError(v, err, es[..n], converted) &&
      (if converted.Thrown? then ( n == |es| && out == converted
       ) else ( n < |es| && es[n].operation == AllocateArray([converted.value]) &&
         (if es[n].outcome.Thrown? then ( n+1 == |es| && out == es[n].outcome
          ) else ( ArrayAllocated(v, es[n], [converted.value], r.arrayPrototype) &&
            DocumentAllocation(v, contents, es[n].outcome.value, r.arrayPrototype,
              r.objectPrototype, r.functionPrototype, es[n+1..], out)) )) )
  ) }
  ghost predicate FirstFallback(v: map<Handle, Value>, r: Realm,
      text: Handle, es: seq<Event>, contents: Handle) reads {} {
    exists n: int, parsed: Outcome :: ( 0 < n <= |es| &&
      NativeParseCompletion(v, text, r.undefined, r.undefined, true, es[..n], parsed) &&
      (if parsed.Thrown? then ( n == |es| && contents == r.undefined
       ) else ( |es| == n+1 && es[n].operation == ReadArrayIndex(parsed.value, 0) &&
         contents == (if es[n].outcome.Thrown? then ( r.undefined ) else ( es[n].outcome.value) )) )
  ) }
  ghost predicate SingleDocumentTry(v: map<Handle, Value>, r: Realm,
      text: Handle, es: seq<Event>, out: Outcome) reads {} {
    exists n: int, parsed: Outcome :: ( 0 < n <= |es| &&
      NativeParseCompletion(v, text, r.undefined, r.undefined, false, es[..n], parsed) &&
      (if parsed.Thrown? then ( n == |es| && out == parsed
       ) else ( DefaultDocument(v, r, parsed.value, es[n..], out)) )
  ) }
  ghost predicate YamlParseDocumentCompletion(v: map<Handle, Value>, r: Realm,
      text: Handle, options: Handle, es: seq<Event>, out: Outcome) reads {} {
    Inputs(v, r, [text, options], es) &&
    exists n: int, checked: Outcome :: ( 0 <= n <= |es| &&
      ValidateOptions(v, YamlRead, options, r.coreIdentity, r.undefined, es[..n], checked) &&
      (if checked.Thrown? then ( n == |es| && out == checked
       ) else ( exists m: int, attempted: Outcome :: (
         SingleDocumentSlice(v, r, text, es, n, m, attempted) &&
         (if attempted.Returned? then ( n+m == |es| && out == attempted
          ) else ( exists split: int, k: int, contents: Handle :: (
            split == n+m &&
            FallbackSlice(v, r, text, es, split, k, contents) &&
            ErrorDocument(v, r, contents, attempted.value, es[split+k..], out)) ) )) ) )
  ) }
  // A generic host [[Call]] may invoke its callback zero/many times, catch callback
  // throws, choose its own result, or ignore the callback. Every recorded callback
  // execution is the actual Dafny document constructor, never a semantic extern.
  ghost predicate MapDocuments(v: map<Handle, Value>, r: Realm,
      documents: Handle, es: seq<Event>, out: Outcome) reads {} {
    |es| > 0 && es[0].operation == ReadProperty(documents, "map") &&
    (if es[0].outcome.Thrown? then ( |es| == 1 && out == es[0].outcome
     ) else ( |es| >= 2 && es[1].operation == AllocateClosure("makeDocumentCallback", r.undefined) &&
       (if es[1].outcome.Thrown? then ( |es| == 2 && out == es[1].outcome
        ) else ( ClosureAllocated(v, es[1], "makeDocumentCallback", r.undefined, r.functionPrototype) &&
          |es| == 3 && es[2].operation.CallMethod? &&
          es[2].operation.methodValue == es[0].outcome.value && es[2].operation.receiver == documents &&
          es[2].operation.arguments == [es[1].outcome.value] && out == es[2].outcome &&
          (forall call | call in es[2].operation.invocations :: (
            call.callback == es[1].outcome.value &&
            DefaultDocument(v, r, (if |call.arguments| == 0 then ( r.undefined ) else ( call.arguments[0]) ),
              call.events, call.outcome)) )) )) )
  }
  ghost predicate AllDocumentsTry(v: map<Handle, Value>, r: Realm,
      text: Handle, es: seq<Event>, out: Outcome) reads {} {
    exists n: int, parsed: Outcome :: ( 0 < n <= |es| &&
      NativeParseCompletion(v, text, r.undefined, r.undefined, true, es[..n], parsed) &&
      (if parsed.Thrown? then ( n == |es| && out == parsed
       ) else ( MapDocuments(v, r, parsed.value, es[n..], out)) )
  ) }
  ghost predicate YamlParseAllDocumentsCompletion(v: map<Handle, Value>, r: Realm,
      text: Handle, options: Handle, es: seq<Event>, out: Outcome) reads {} {
    Inputs(v, r, [text, options], es) &&
    exists n: int, checked: Outcome :: ( 0 <= n <= |es| &&
      ValidateOptions(v, YamlRead, options, r.coreIdentity, r.undefined, es[..n], checked) &&
      (if checked.Thrown? then ( n == |es| && out == checked
       ) else ( exists m: int, attempted: Outcome :: (
         AllDocumentsSlice(v, r, text, es, n, m, attempted) &&
         (if attempted.Returned? then ( n+m == |es| && out == attempted
          ) else ( exists split: int, k: int, document: Outcome :: (
            split == n+m &&
            ErrorDocumentSlice(v, r, r.undefined, attempted.value, es, split, k, document) &&
            (if document.Thrown? then ( split+k == |es| && out == document
             ) else ( ExactEvent(es[split+k..], AllocateArray([document.value]), out) &&
               (out.Thrown? || ArrayAllocated(v, es[|es|-1], [document.value], r.arrayPrototype))) )) ) )) ) )
  ) }
}
