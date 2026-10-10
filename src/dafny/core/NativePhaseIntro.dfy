module NativePhaseIntro {
  import opened SurfaceModel
  import NC = NativeContracts

  lemma {:isolate_assertions} PrependFirstOptimizationsRead(values: map<Handle, Value>, options: Handle, opt1: Handle, internRaw: Handle, strictRaw: Handle, opt2: Handle, budgetRaw: Handle, undefined: Handle, head: Event, tail: seq<Event>, result: Normalized)
    requires ValuesValid(values)
    requires options in values && undefined in values && values[undefined].UndefinedValue?
    requires opt1 in values && internRaw in values && strictRaw in values && opt2 in values && budgetRaw in values
    requires !StrictNullish(values[options])
    requires head.operation == ReadProperty(options, "optimizations")
    requires head.outcome.value in values
    requires head.outcome.Thrown? ==> tail == [] && result == NormalizationFailure(head.outcome.value)
    requires head.outcome.Returned? ==> NC.NormalizeAt(values, options, 1, head.outcome.value, undefined, undefined, undefined, undefined, undefined, tail, result)
    ensures NC.NormalizeAt(values, options, 0, opt1, internRaw, strictRaw, opt2, budgetRaw, undefined, [head] + tail, result)
  {
    assert ([head] + tail)[0] == head;
    assert ([head] + tail)[1..] == tail;
  }

  lemma {:isolate_assertions} PrependInternStringsRead(values: map<Handle, Value>, options: Handle, opt1: Handle, internRaw: Handle, strictRaw: Handle, opt2: Handle, budgetRaw: Handle, undefined: Handle, head: Event, tail: seq<Event>, result: Normalized)
    requires ValuesValid(values)
    requires options in values && undefined in values && values[undefined].UndefinedValue?
    requires opt1 in values && internRaw in values && strictRaw in values && opt2 in values && budgetRaw in values
    requires !StrictNullish(values[opt1])
    requires head.operation == ReadProperty(opt1, "internStrings")
    requires head.outcome.value in values
    requires head.outcome.Thrown? ==> tail == [] && result == NormalizationFailure(head.outcome.value)
    requires head.outcome.Returned? ==> NC.NormalizeAt(values, options, 2, opt1, head.outcome.value, strictRaw, opt2, budgetRaw, undefined, tail, result)
    ensures NC.NormalizeAt(values, options, 1, opt1, internRaw, strictRaw, opt2, budgetRaw, undefined, [head] + tail, result)
  {
    assert ([head] + tail)[0] == head;
    assert ([head] + tail)[1..] == tail;
  }

  lemma {:isolate_assertions} PrependStrictRead(values: map<Handle, Value>, options: Handle, opt1: Handle, internRaw: Handle, strictRaw: Handle, opt2: Handle, budgetRaw: Handle, undefined: Handle, head: Event, tail: seq<Event>, result: Normalized)
    requires ValuesValid(values)
    requires options in values && undefined in values && values[undefined].UndefinedValue?
    requires opt1 in values && internRaw in values && strictRaw in values && opt2 in values && budgetRaw in values
    requires head.operation == ReadProperty(options, "strict")
    requires head.outcome.value in values
    requires head.outcome.Thrown? ==> tail == [] && result == NormalizationFailure(head.outcome.value)
    requires head.outcome.Returned? ==> NC.NormalizeAt(values, options, 3, opt1, internRaw, head.outcome.value, opt2, budgetRaw, undefined, tail, result)
    ensures NC.NormalizeAt(values, options, 2, opt1, internRaw, strictRaw, opt2, budgetRaw, undefined, [head] + tail, result)
  {
    assert ([head] + tail)[0] == head;
    assert ([head] + tail)[1..] == tail;
  }

  lemma {:isolate_assertions} PrependSecondOptimizationsRead(values: map<Handle, Value>, options: Handle, opt1: Handle, internRaw: Handle, strictRaw: Handle, opt2: Handle, budgetRaw: Handle, undefined: Handle, head: Event, tail: seq<Event>, result: Normalized)
    requires ValuesValid(values)
    requires options in values && undefined in values && values[undefined].UndefinedValue?
    requires opt1 in values && internRaw in values && strictRaw in values && opt2 in values && budgetRaw in values
    requires head.operation == ReadProperty(options, "optimizations")
    requires head.outcome.value in values
    requires head.outcome.Thrown? ==> tail == [] && result == NormalizationFailure(head.outcome.value)
    requires head.outcome.Returned? ==> NC.NormalizeAt(values, options, 4, opt1, internRaw, strictRaw, head.outcome.value, budgetRaw, undefined, tail, result)
    ensures NC.NormalizeAt(values, options, 3, opt1, internRaw, strictRaw, opt2, budgetRaw, undefined, [head] + tail, result)
  {
    assert ([head] + tail)[0] == head;
    assert ([head] + tail)[1..] == tail;
  }

  lemma {:isolate_assertions} PrependBudgetRead(values: map<Handle, Value>, options: Handle, opt1: Handle, internRaw: Handle, strictRaw: Handle, opt2: Handle, budgetRaw: Handle, undefined: Handle, head: Event, tail: seq<Event>, result: Normalized)
    requires ValuesValid(values)
    requires options in values && undefined in values && values[undefined].UndefinedValue?
    requires opt1 in values && internRaw in values && strictRaw in values && opt2 in values && budgetRaw in values
    requires !StrictNullish(values[opt2])
    requires head.operation == ReadProperty(opt2, "keyCacheMaxKb")
    requires head.outcome.value in values
    requires head.outcome.Thrown? ==> tail == [] && result == NormalizationFailure(head.outcome.value)
    requires head.outcome.Returned? ==> NC.NormalizeAt(values, options, 6, opt1, internRaw, strictRaw, opt2, head.outcome.value, undefined, tail, result)
    ensures NC.NormalizeAt(values, options, 4, opt1, internRaw, strictRaw, opt2, budgetRaw, undefined, [head] + tail, result)
  {
    assert ([head] + tail)[0] == head;
    assert ([head] + tail)[1..] == tail;
  }

  lemma {:isolate_assertions} SkipAbsentOptions(values: map<Handle, Value>, options: Handle, opt1: Handle, internRaw: Handle, strictRaw: Handle, opt2: Handle, budgetRaw: Handle, undefined: Handle, events: seq<Event>, result: Normalized)
    requires ValuesValid(values)
    requires options in values && undefined in values && values[undefined].UndefinedValue?
    requires opt1 in values && internRaw in values && strictRaw in values && opt2 in values && budgetRaw in values
    requires StrictNullish(values[options])
    requires NC.NormalizeAt(values, options, 6, undefined, undefined, undefined, undefined, undefined, undefined, events, result)
    ensures NC.NormalizeAt(values, options, 0, opt1, internRaw, strictRaw, opt2, budgetRaw, undefined, events, result)
  { }

  lemma {:isolate_assertions} SkipAbsentFirstOptimizations(values: map<Handle, Value>, options: Handle, opt1: Handle, internRaw: Handle, strictRaw: Handle, opt2: Handle, budgetRaw: Handle, undefined: Handle, events: seq<Event>, result: Normalized)
    requires ValuesValid(values)
    requires options in values && undefined in values && values[undefined].UndefinedValue?
    requires opt1 in values && internRaw in values && strictRaw in values && opt2 in values && budgetRaw in values
    requires StrictNullish(values[opt1])
    requires NC.NormalizeAt(values, options, 2, opt1, undefined, strictRaw, opt2, budgetRaw, undefined, events, result)
    ensures NC.NormalizeAt(values, options, 1, opt1, internRaw, strictRaw, opt2, budgetRaw, undefined, events, result)
  { }

  lemma {:isolate_assertions} SkipAbsentBudgetOptimizations(values: map<Handle, Value>, options: Handle, opt1: Handle, internRaw: Handle, strictRaw: Handle, opt2: Handle, budgetRaw: Handle, undefined: Handle, events: seq<Event>, result: Normalized)
    requires ValuesValid(values)
    requires options in values && undefined in values && values[undefined].UndefinedValue?
    requires opt1 in values && internRaw in values && strictRaw in values && opt2 in values && budgetRaw in values
    requires StrictNullish(values[opt2])
    requires NC.NormalizeAt(values, options, 6, opt1, internRaw, strictRaw, opt2, undefined, undefined, events, result)
    ensures NC.NormalizeAt(values, options, 4, opt1, internRaw, strictRaw, opt2, budgetRaw, undefined, events, result)
  { }

  lemma {:isolate_assertions} MultiplyLeaf(values: map<Handle, Value>, options: Handle, opt1: Handle, internRaw: Handle, strictRaw: Handle, opt2: Handle, budgetRaw: Handle, undefined: Handle, head: Event, result: Normalized)
    requires ValuesValid(values)
    requires options in values && undefined in values && values[undefined].UndefinedValue?
    requires opt1 in values && internRaw in values && strictRaw in values && opt2 in values && budgetRaw in values
    requires head.operation == MultiplyBudget(budgetRaw, StrictNullish(values[budgetRaw]))
    requires head.outcome.value in values
    requires result == (if head.outcome.Thrown? then NormalizationFailure(head.outcome.value)
      else Ready(ExactlyTrue(values[strictRaw]), Truthy(values[internRaw]), head.outcome.value))
    ensures NC.NormalizeAt(values, options, 6, opt1, internRaw, strictRaw, opt2, budgetRaw, undefined, [head], result)
  { }
}
