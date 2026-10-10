module NativeParseComposition {
  import opened SurfaceModel
  import NC = NativeContracts

  lemma ArraySkip(values: map<Handle,Value>, input: Outcome)
    requires input.Thrown?
    ensures NC.ArrayGuard(values,input,[],input)
  { }

  lemma {:isolate_assertions} ArrayHead(values: map<Handle,Value>, input: Outcome,
      check: Event, tail: seq<Event>, output: Outcome)
    requires input.Returned?
    requires check.operation == CheckArray(input.value)
    requires check.outcome.value in values
    requires check.outcome.Thrown? ==> tail == [] && output == check.outcome
    requires check.outcome.Returned? && Truthy(values[check.outcome.value]) ==>
      tail == [] && output == input
    requires check.outcome.Returned? && !Truthy(values[check.outcome.value]) ==>
      |tail| == 1 && tail[0].operation ==
        NewTypeError("Dafny parseAll returned a non-array value") &&
        tail[0].outcome.Thrown? && output == tail[0].outcome
    ensures NC.ArrayGuard(values,input,[check]+tail,output)
  {
    assert ([check]+tail)[0] == check;
    assert ([check]+tail)[1..] == tail;
  }

  lemma NormalizeFailed(values: map<Handle,Value>, text: Handle, all: bool,
      normalized: Normalized)
    requires normalized.NormalizationFailure?
    ensures NC.AfterNormalization(values,text,all,normalized,[],Thrown(normalized.thrown))
  { }

  lemma ResetFailed(values: map<Handle,Value>, text: Handle, all: bool,
      normalized: Normalized, reset: Event)
    requires normalized.Ready?
    requires reset.operation == Reset(text,normalized.strict,normalized.intern,normalized.budget)
    requires reset.outcome.Thrown?
    ensures NC.AfterNormalization(values,text,all,normalized,[reset],reset.outcome)
  { }

  lemma {:isolate_assertions} SingleParsed(values: map<Handle,Value>, text: Handle,
      normalized: Normalized, reset: Event, parsed: Event)
    requires normalized.Ready?
    requires reset.operation == Reset(text,normalized.strict,normalized.intern,normalized.budget)
    requires reset.outcome.Returned?
    requires parsed.operation == ParseCore(false)
    ensures NC.AfterNormalization(values,text,false,normalized,[reset,parsed],parsed.outcome)
  { }

  lemma {:isolate_assertions} AllParsed(values: map<Handle,Value>, text: Handle,
      normalized: Normalized, reset: Event, parsed: Event,
      guards: seq<Event>, pending: Outcome)
    requires normalized.Ready?
    requires reset.operation == Reset(text,normalized.strict,normalized.intern,normalized.budget)
    requires reset.outcome.Returned?
    requires parsed.operation == ParseCore(true)
    requires NC.ArrayGuard(values,parsed.outcome,guards,pending)
    ensures NC.AfterNormalization(values,text,true,normalized,[reset,parsed]+guards,pending)
  {
    assert ([reset,parsed]+guards)[0] == reset;
    assert ([reset,parsed]+guards)[1] == parsed;
    assert ([reset,parsed]+guards)[2..] == guards;
  }

  lemma Cleanup(pending: Outcome, cleanup: Event)
    requires cleanup.operation == EndStream
    ensures NC.CleanupCompletion(pending,[cleanup],
      if cleanup.outcome.Thrown? then cleanup.outcome else pending)
  { }

  lemma {:isolate_assertions} Finish(values: map<Handle,Value>, text: Handle,
      options: Handle, undefined: Handle, all: bool, prefix: seq<Event>,
      normalized: Normalized, middle: seq<Event>, pending: Outcome, cleanup: Event)
    requires NC.NormalizationTrace(values,options,undefined,prefix,normalized)
    requires NC.AfterNormalization(values,text,all,normalized,middle,pending)
    requires TraceLinked(prefix+middle+[cleanup])
    requires TraceValues(values,prefix+middle+[cleanup])
    requires cleanup.operation == EndStream
    ensures NC.NativeParseCompletion(values,text,options,undefined,all,
      prefix+middle+[cleanup],if cleanup.outcome.Thrown? then cleanup.outcome else pending)
  {
    var events := prefix+middle+[cleanup];
    var split := |prefix|;
    assert |events| == |prefix|+|middle|+1;
    assert events[..split] == prefix;
    assert events[split..|events|-1] == middle;
    assert events[|events|-1..] == [cleanup];
    assert NC.NativeParsePartition(values,text,options,undefined,all,events,
      split,normalized,pending);
    Cleanup(pending,cleanup);
    assert exists n: int, chosen: Normalized, previous: Outcome ::
      NC.NativeParsePartition(values,text,options,undefined,all,events,n,chosen,previous) &&
      NC.CleanupCompletion(previous,events[|events|-1..],
        if cleanup.outcome.Thrown? then cleanup.outcome else pending);
  }
}
