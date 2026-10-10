module ObjectsAndErrors {
  import opened SurfaceModel

  ghost predicate OrdinaryData(p: Property) reads {} {
    p.writable && p.enumerable && p.configurable
  }
  ghost predicate RecordAllocated(values: map<Handle, Value>, e: Event,
      properties: seq<Property>, prototype: nat, captured: seq<Handle>) reads {} {
    e.operation == AllocateRecord(properties, prototype, captured) && e.outcome.Returned? &&
    e.outcome.value in values && values[e.outcome.value].ReferenceValue? &&
    values[e.outcome.value].kind == ObjectReference &&
    values[e.outcome.value].identity !in e.before &&
    e.after == e.before[values[e.outcome.value].identity := ObjectState(prototype, properties, captured, "")]
  }
  ghost predicate ArrayAllocated(values: map<Handle, Value>, e: Event,
      elements: seq<Handle>, arrayPrototype: nat) reads {} {
    e.operation == AllocateArray(elements) && e.outcome.Returned? &&
    e.outcome.value in values && values[e.outcome.value].ReferenceValue? &&
    values[e.outcome.value].kind == ArrayReference &&
    values[e.outcome.value].identity !in e.before &&
    values[e.outcome.value].identity in e.after &&
    e.after[values[e.outcome.value].identity].prototype == arrayPrototype &&
    e.after[values[e.outcome.value].identity].captured == elements &&
    e.after == e.before[values[e.outcome.value].identity := e.after[values[e.outcome.value].identity]]
  }
  ghost predicate ClosureAllocated(values: map<Handle, Value>, e: Event,
      name: string, captured: Handle, functionPrototype: nat) reads {} {
    e.operation == AllocateClosure(name, captured) && e.outcome.Returned? &&
    e.outcome.value in values && values[e.outcome.value].ReferenceValue? &&
    values[e.outcome.value].kind == ClosureReference &&
    values[e.outcome.value].identity !in e.before &&
    values[e.outcome.value].identity in e.after &&
    e.after[values[e.outcome.value].identity].prototype == functionPrototype &&
    e.after[values[e.outcome.value].identity].captured == [captured] &&
    e.after[values[e.outcome.value].identity].closureName == name &&
    e.after == e.before[values[e.outcome.value].identity := e.after[values[e.outcome.value].identity]]
  }
  ghost predicate DocumentAllocation(values: map<Handle, Value>, contents: Handle,
      errors: Handle, arrayPrototype: nat, objectPrototype: nat, functionPrototype: nat,
      events: seq<Event>, output: Outcome) reads {} {
    TraceLinked(events) && TraceValues(values, events) && |events| > 0 &&
    events[0].operation == AllocateArray([]) &&
    (if events[0].outcome.Thrown? then ( |events| == 1 && output == events[0].outcome
     ) else ( ArrayAllocated(values, events[0], [], arrayPrototype) && |events| >= 2 &&
      events[1].operation == AllocateClosure("toJS", contents) &&
      (if events[1].outcome.Thrown? then ( |events| == 2 && output == events[1].outcome
       ) else ( ClosureAllocated(values, events[1], "toJS", contents, functionPrototype) && |events| >= 3 &&
        events[2].operation == AllocateClosure("toJSON", contents) &&
        (if events[2].outcome.Thrown? then ( |events| == 3 && output == events[2].outcome
         ) else ( ClosureAllocated(values, events[2], "toJSON", contents, functionPrototype) && |events| == 4 &&
          var properties := [Property("contents", contents, true, true, true),
            Property("errors", errors, true, true, true),
            Property("warnings", events[0].outcome.value, true, true, true),
            Property("toJS", events[1].outcome.value, true, true, true),
            Property("toJSON", events[2].outcome.value, true, true, true)];
          events[3].operation == AllocateRecord(properties, objectPrototype, []) &&
          output == events[3].outcome &&
          (output.Thrown? || RecordAllocated(values, events[3], properties, objectPrototype, []))) )) )) )
  }
  ghost predicate CapturedDocumentMethod(heap: Heap, closureIdentity: nat,
      events: seq<Event>, output: Outcome) reads {} {
    closureIdentity in heap && |heap[closureIdentity].captured| == 1 &&
    (heap[closureIdentity].closureName == "toJS" || heap[closureIdentity].closureName == "toJSON") &&
    |events| == 0 && output == Returned(heap[closureIdentity].captured[0])
  }
  ghost predicate Digits(s: string) reads {} {
    |s| > 0 && forall i | 0 <= i < |s| :: ( '0' <= s[i] <= '9'
  ) }
  ghost predicate RegexWhitespace(c: char) reads {} {
    c == '\t' || c == '\n' || c == '\u000B' || c == '\u000C' || c == '\r' ||
    c == ' ' || c == '\u00A0' || c == '\u1680' ||
    '\u2000' <= c <= '\u200A' || c == '\u2028' || c == '\u2029' ||
    c == '\u202F' || c == '\u205F' || c == '\u3000' || c == '\uFEFF'
  }
  ghost predicate MarkSuffix(s: string, line: string, column: string) reads {} {
    Digits(line) && Digits(column) &&
    exists prefix: string, whitespace: string :: (
      s == prefix + "(line " + line + ", column " + column + ")" + whitespace &&
      forall i | 0 <= i < |whitespace| :: ( RegexWhitespace(whitespace[i])
  ) ) }
  ghost predicate NoMarkSuffix(s: string) reads {} {
    !exists line: string, column: string :: ( MarkSuffix(s, line, column)
  ) }
  ghost predicate MarkRecord(values: map<Handle, Value>, e: Event,
      filename: Handle, empty: Handle, zero: Handle, negativeOne: Handle,
      line: Handle, column: Handle, objectPrototype: nat) reads {} {
    filename in values && empty in values && zero in values && negativeOne in values &&
    values[empty] == StringValue("") && values[zero] == NumberValue(0) &&
    values[negativeOne] == NumberValue(13830554455654793216) &&
    var name := if StrictNullish(values[filename]) then ( empty ) else ( filename) ;
    var properties := [Property("buffer", empty, true, true, true), Property("column", column, true, true, true),
       Property("line", line, true, true, true), Property("name", name, true, true, true),
       Property("position", negativeOne, true, true, true), Property("snippet", empty, true, true, true)];
    e.operation == AllocateRecord(properties, objectPrototype, []) &&
      (e.outcome.Thrown? || RecordAllocated(values, e, properties, objectPrototype, []))
  }
  // Standard regex-result profile: a successful match supplies digit-string
  // captures for the source suffix. Arbitrary exec results/capture getters and
  // actual Number/Math lookup, call and coercion correspondence remain OPEN.
  ghost predicate BuildMark(values: map<Handle, Value>, message: Handle,
      filename: Handle, empty: Handle, zero: Handle, negativeOne: Handle,
      objectPrototype: nat, events: seq<Event>, output: Outcome) reads {} {
    TraceLinked(events) && TraceValues(values, events) && |events| > 0 &&
    events[0].operation.RegexMark? && events[0].operation.regexMessage == message &&
    (if events[0].outcome.Thrown? then ( |events| == 1 && output == events[0].outcome
     ) else ( var regex := events[0].operation;
      (if !regex.matched then ( NoMarkSuffix(regex.coercedText) && |events| >= 2 &&
        events[1].operation == ClampMinusOne(zero) &&
        (if events[1].outcome.Thrown? then ( |events| == 2 && output == events[1].outcome
         ) else ( |events| >= 3 && events[2].operation == ClampMinusOne(zero) &&
          (if events[2].outcome.Thrown? then ( |events| == 3 && output == events[2].outcome
           ) else ( |events| == 4 && output == events[3].outcome &&
             MarkRecord(values, events[3], filename, empty, zero, negativeOne,
               events[2].outcome.value, events[1].outcome.value, objectPrototype)) )) )
       ) else ( MarkSuffix(regex.coercedText, regex.lineDigits, regex.columnDigits) && |events| >= 2 &&
        events[1].operation == NumberFromString(regex.lineDigits) &&
        (if events[1].outcome.Thrown? then ( |events| == 2 && output == events[1].outcome
         ) else ( |events| >= 3 && events[2].operation == NumberFromString(regex.columnDigits) &&
          (if events[2].outcome.Thrown? then ( |events| == 3 && output == events[2].outcome
           ) else ( |events| >= 4 && events[3].operation == ClampMinusOne(events[2].outcome.value) &&
            (if events[3].outcome.Thrown? then ( |events| == 4 && output == events[3].outcome
             ) else ( |events| >= 5 && events[4].operation == ClampMinusOne(events[1].outcome.value) &&
              (if events[4].outcome.Thrown? then ( |events| == 5 && output == events[4].outcome
               ) else ( |events| == 6 && output == events[5].outcome &&
                MarkRecord(values, events[5], filename, empty, zero, negativeOne,
                  events[4].outcome.value, events[3].outcome.value, objectPrototype)) )) )) )) )) )) )
  }
  ghost predicate ExceptionToString(values: map<Handle, Value>, receiver: Handle,
      events: seq<Event>, output: Outcome) reads {} {
    TraceLinked(events) && TraceValues(values, events) && |events| > 0 &&
    events[0].operation == ReadProperty(receiver, "name") &&
    (if events[0].outcome.Thrown? then ( |events| == 1 && output == events[0].outcome
     ) else ( |events| >= 2 && events[1].operation == TemplateConvert(events[0].outcome.value) &&
      (if events[1].outcome.Thrown? then ( |events| == 2 && output == events[1].outcome
       ) else ( events[1].outcome.value in values && values[events[1].outcome.value].StringValue? &&
        |events| >= 3 && events[2].operation == ReadProperty(receiver, "message") &&
        (if events[2].outcome.Thrown? then ( |events| == 3 && output == events[2].outcome
         ) else ( |events| == 4 && events[3].operation == TemplateConvert(events[2].outcome.value) &&
          (if events[3].outcome.Thrown? then ( output == events[3].outcome
           ) else ( events[3].outcome.value in values && values[events[3].outcome.value].StringValue? &&
            output.Returned? && output.value in values &&
            values[output.value] == StringValue(values[events[1].outcome.value].text + ": " +
              values[events[3].outcome.value].text)) )) )) )) )
  }
}
