module NativeContracts {
  import opened SurfaceModel

  ghost predicate NormalizeAt(values: map<Handle, Value>, options: Handle,
      phase: nat, opt1: Handle, internRaw: Handle, strictRaw: Handle,
      opt2: Handle, budgetRaw: Handle, undefined: Handle,
      events: seq<Event>, result: Normalized) reads {}
    requires ValuesValid(values)
    requires options in values && undefined in values && values[undefined].UndefinedValue?
    requires opt1 in values && internRaw in values && strictRaw in values && opt2 in values && budgetRaw in values
    decreases |events|, 8 - phase
  {
    if phase == 0 then (
      (if StrictNullish(values[options]) then (
        NormalizeAt(values, options, 6, undefined, undefined, undefined, undefined, undefined, undefined, events, result)
       ) else ( |events| > 0 && events[0].operation == ReadProperty(options, "optimizations") &&
        events[0].outcome.value in values &&
        (if events[0].outcome.Thrown? then (
          |events| == 1 && result == NormalizationFailure(events[0].outcome.value)
         ) else ( NormalizeAt(values, options, 1, events[0].outcome.value, undefined,
          undefined, undefined, undefined, undefined, events[1..], result)) )) )
    ) else ( if phase == 1 then (
      (if StrictNullish(values[opt1]) then (
        NormalizeAt(values, options, 2, opt1, undefined, strictRaw, opt2, budgetRaw, undefined, events, result)
       ) else ( |events| > 0 && events[0].operation == ReadProperty(opt1, "internStrings") &&
        events[0].outcome.value in values &&
        (if events[0].outcome.Thrown? then ( |events| == 1 && result == NormalizationFailure(events[0].outcome.value)
         ) else ( NormalizeAt(values, options, 2, opt1, events[0].outcome.value,
          strictRaw, opt2, budgetRaw, undefined, events[1..], result)) )) )
    ) else ( if phase == 2 then (
      |events| > 0 && events[0].operation == ReadProperty(options, "strict") &&
      events[0].outcome.value in values &&
      (if events[0].outcome.Thrown? then ( |events| == 1 && result == NormalizationFailure(events[0].outcome.value)
       ) else ( NormalizeAt(values, options, 3, opt1, internRaw,
        events[0].outcome.value, opt2, budgetRaw, undefined, events[1..], result)) )
    ) else ( if phase == 3 then (
      |events| > 0 && events[0].operation == ReadProperty(options, "optimizations") &&
      events[0].outcome.value in values &&
      (if events[0].outcome.Thrown? then ( |events| == 1 && result == NormalizationFailure(events[0].outcome.value)
       ) else ( NormalizeAt(values, options, 4, opt1, internRaw,
        strictRaw, events[0].outcome.value, budgetRaw, undefined, events[1..], result)) )
    ) else ( if phase == 4 then (
      (if StrictNullish(values[opt2]) then (
        NormalizeAt(values, options, 6, opt1, internRaw, strictRaw, opt2, undefined, undefined, events, result)
       ) else ( |events| > 0 && events[0].operation == ReadProperty(opt2, "keyCacheMaxKb") &&
        events[0].outcome.value in values &&
        (if events[0].outcome.Thrown? then ( |events| == 1 && result == NormalizationFailure(events[0].outcome.value)
         ) else ( NormalizeAt(values, options, 6, opt1, internRaw,
          strictRaw, opt2, events[0].outcome.value, undefined, events[1..], result)) )) )
    ) else ( if phase == 6 then (
      |events| == 1 && events[0].operation == MultiplyBudget(budgetRaw, StrictNullish(values[budgetRaw])) &&
      events[0].outcome.value in values &&
      (if events[0].outcome.Thrown? then ( result == NormalizationFailure(events[0].outcome.value)
       ) else ( result == Ready(ExactlyTrue(values[strictRaw]), Truthy(values[internRaw]), events[0].outcome.value)) )
    ) else ( false
  ) ) ) ) ) ) }

  ghost predicate NormalizationTrace(values: map<Handle, Value>, options: Handle,
      undefined: Handle, events: seq<Event>, result: Normalized) reads {} {
    ValuesValid(values) && options in values && undefined in values && values[undefined].UndefinedValue? &&
    TraceLinked(events) && TraceValues(values, events) &&
    NormalizeAt(values, options, 0, undefined, undefined, undefined, undefined, undefined, undefined, events, result)
  }

  ghost predicate ArrayGuard(values: map<Handle, Value>, input: Outcome,
      events: seq<Event>, output: Outcome) reads {} {
    if input.Thrown? then ( |events| == 0 && output == input
    ) else ( |events| > 0 && events[0].operation == CheckArray(input.value) &&
      (if events[0].outcome.Thrown? then ( |events| == 1 && output == events[0].outcome
       ) else ( if events[0].outcome.value in values && Truthy(values[events[0].outcome.value]) then ( |events| == 1 && output == input
       ) else ( events[0].outcome.value in values && !Truthy(values[events[0].outcome.value]) && |events| == 2 &&
        events[1].operation == NewTypeError("Dafny parseAll returned a non-array value") &&
        events[1].outcome.Thrown? && output == events[1].outcome) ) )
  ) }
  ghost predicate AfterNormalization(values: map<Handle, Value>, text: Handle,
      all: bool, normalized: Normalized, events: seq<Event>, pending: Outcome) reads {} {
    if normalized.NormalizationFailure? then (
      |events| == 0 && pending == Thrown(normalized.thrown)
    ) else ( |events| > 0 && events[0].operation == Reset(text, normalized.strict, normalized.intern, normalized.budget) &&
      (if events[0].outcome.Thrown? then ( |events| == 1 && pending == events[0].outcome
       ) else ( |events| >= 2 && events[1].operation == ParseCore(all) &&
        (if all then ( ArrayGuard(values, events[1].outcome, events[2..], pending)
         ) else ( |events| == 2 && pending == events[1].outcome) )) )
  ) }
  ghost predicate CleanupCompletion(pending: Outcome, events: seq<Event>, output: Outcome) reads {} {
    |events| == 1 && events[0].operation == EndStream &&
    output == (if events[0].outcome.Thrown? then ( events[0].outcome ) else ( pending) )
  }
  ghost predicate NativeParseCompletion(values: map<Handle, Value>, text: Handle,
      options: Handle, undefined: Handle, all: bool, events: seq<Event>, output: Outcome) reads {} {
    TraceLinked(events) && TraceValues(values, events) &&
    exists n: int, normalized: Normalized, pending: Outcome :: (
      NativeParsePartition(values, text, options, undefined, all, events, n, normalized, pending) &&
      CleanupCompletion(pending, events[|events|-1..], output)
  ) }
  ghost predicate NativeParsePartition(values: map<Handle, Value>, text: Handle,
      options: Handle, undefined: Handle, all: bool, events: seq<Event>,
      split: int, normalized: Normalized, pending: Outcome) reads {} {
    |events| >= 1 && 0 <= split < |events| &&
    NormalizationTrace(values, options, undefined, events[..split], normalized) &&
    AfterNormalization(values, text, all, normalized, events[split..|events|-1], pending)
  }
  ghost predicate NativeStringifyCompletion(values: map<Handle, Value>, argument: Handle,
      events: seq<Event>, output: Outcome) reads {} {
    TraceLinked(events) && TraceValues(values, events) && |events| > 0 &&
    events[0].operation == StringifyCore(argument) &&
    (if events[0].outcome.Thrown? then ( |events| == 1 && output == events[0].outcome
     ) else ( events[0].outcome.value in values &&
      (if values[events[0].outcome.value].StringValue? then ( |events| == 1 && output == events[0].outcome
       ) else ( |events| == 2 && events[1].operation == NewTypeError("Dafny stringify returned a non-string value") &&
        events[1].outcome.Thrown? && output == events[1].outcome) )) )
  }
}
