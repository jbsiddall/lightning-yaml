module NativeTraceLemmas {
  import M = SurfaceModel
  import NC = NativeContracts
  import W = SurfaceWitness
  import N = Native
  import H = HostObservation
  import NB = NativeBudgetContracts

  ghost predicate ValuesExtend(before: map<M.Handle,M.Value>, after: map<M.Handle,M.Value>) reads {} {
    M.ValuesValid(before) && M.ValuesValid(after) &&
      (forall h | h in before :: h in after && after[h] == before[h])
  }
  ghost predicate BindingsExtend(before: seq<W.Binding>, after: seq<W.Binding>) reads {} {
    forall binding | binding in before :: binding in after
  }
  lemma ValuesExtendTransitive(first: map<M.Handle,M.Value>,
      middle: map<M.Handle,M.Value>, last: map<M.Handle,M.Value>)
    requires ValuesExtend(first,middle) && ValuesExtend(middle,last)
    ensures ValuesExtend(first,last)
  {}
  lemma BindingsExtendTransitive(first: seq<W.Binding>,
      middle: seq<W.Binding>, last: seq<W.Binding>)
    requires BindingsExtend(first,middle) && BindingsExtend(middle,last)
    ensures BindingsExtend(first,last)
  {}
  ghost predicate BoundIn(bindings: seq<W.Binding>, raw: N.Value, handle: M.Handle) reads {} {
    exists binding | binding in bindings ::
      H.RawSameValue(binding.raw,raw) && binding.handle == handle
  }
  lemma BudgetOutcomeGuaranteesExtension(before: map<M.Handle,M.Value>,
      after: map<M.Handle,M.Value>, rawHandle: M.Handle, useDefault: bool,
      outcome: M.Outcome, eventAfter: M.Heap)
    requires ValuesExtend(before,after)
    requires NB.BudgetOutcomeGuarantees(before,rawHandle,useDefault,outcome,eventAfter)
    ensures NB.BudgetOutcomeGuarantees(after,rawHandle,useDefault,outcome,eventAfter)
  {
    assert rawHandle in before;
    assert outcome.value in before;
    assert after[rawHandle] == before[rawHandle];
    assert after[outcome.value] == before[outcome.value];
  }
  lemma BoundTransport(before: seq<W.Binding>, world: W.World, raw: N.Value, handle: M.Handle)
    requires BoundIn(before,raw,handle)
    requires BindingsExtend(before,world.bindings)
    ensures world.Bound(raw,handle)
  {
    var binding :| binding in before && H.RawSameValue(binding.raw,raw) && binding.handle == handle;
    assert binding in world.bindings;
  }
  lemma TraceValuesExtension(before: map<M.Handle,M.Value>, after: map<M.Handle,M.Value>, events: seq<M.Event>)
    requires ValuesExtend(before,after)
    requires M.TraceValues(before,events)
    ensures M.TraceValues(after,events)
  {
    forall event | event in events
      ensures M.Describes(after,event.outcome.value)
    {
      assert M.Describes(before,event.outcome.value);
      assert event.outcome.value in before;
      assert after[event.outcome.value] == before[event.outcome.value];
    }
  }
  lemma TraceValuesConcat(values: map<M.Handle,M.Value>, left: seq<M.Event>, right: seq<M.Event>)
    requires M.TraceValues(values,left) && M.TraceValues(values,right)
    ensures M.TraceValues(values,left+right)
  {}
  lemma TraceAppend(values: map<M.Handle,M.Value>, prefix: seq<M.Event>, event: M.Event)
    requires M.TraceLinked(prefix)
    requires |prefix| == 0 || prefix[|prefix|-1].after == event.before
    requires M.TraceValues(values,prefix)
    requires M.ValuesValid(values) && event.outcome.value in values
    ensures M.TraceLinked(prefix+[event])
    ensures M.TraceValues(values,prefix+[event])
  {
    assert M.TraceLinked([event]);
    assert M.TraceValues(values,[event]);
    TraceLinkedConcat(prefix,[event]);
    TraceValuesConcat(values,prefix,[event]);
  }
  lemma TraceLinkedConcat(left: seq<M.Event>, right: seq<M.Event>)
    requires M.TraceLinked(left) && M.TraceLinked(right)
    requires |left| == 0 || |right| == 0 || left[|left|-1].after == right[0].before
    ensures M.TraceLinked(left+right)
  {
    forall i | 0 <= i && i+1 < |left+right|
      ensures (left+right)[i].after == (left+right)[i+1].before
    {
      if i+1 < |left| {
        assert left[i].after == left[i+1].before;
      } else if i < |left| {
        assert i == |left|-1 && |right| > 0;
      } else {
        assert 0 <= i-|left| && i-|left|+1 < |right|;
        assert right[i-|left|].after == right[i-|left|+1].before;
      }
    }
  }
  lemma NormalizeAtExtension(before: map<M.Handle,M.Value>, after: map<M.Handle,M.Value>,
      options: M.Handle, phase: nat, opt1: M.Handle, internRaw: M.Handle, strictRaw: M.Handle,
      opt2: M.Handle, budgetRaw: M.Handle, undefined: M.Handle,
      events: seq<M.Event>, result: M.Normalized)
    requires ValuesExtend(before,after)
    requires phase <= 6
    requires options in before && undefined in before && before[undefined].UndefinedValue?
    requires opt1 in before && internRaw in before && strictRaw in before && opt2 in before && budgetRaw in before
    requires NC.NormalizeAt(before,options,phase,opt1,internRaw,strictRaw,opt2,budgetRaw,undefined,events,result)
    ensures NC.NormalizeAt(after,options,phase,opt1,internRaw,strictRaw,opt2,budgetRaw,undefined,events,result)
    decreases |events|, 8-phase
  {
    if phase == 0 {
      if M.StrictNullish(before[options]) {
        NormalizeAtExtension(before,after,options,6,undefined,undefined,undefined,undefined,undefined,undefined,events,result);
      } else if events[0].outcome.Returned? {
        NormalizeAtExtension(before,after,options,1,events[0].outcome.value,undefined,undefined,undefined,undefined,undefined,events[1..],result);
      }
    } else if phase == 1 {
      if M.StrictNullish(before[opt1]) {
        NormalizeAtExtension(before,after,options,2,opt1,undefined,strictRaw,opt2,budgetRaw,undefined,events,result);
      } else if events[0].outcome.Returned? {
        NormalizeAtExtension(before,after,options,2,opt1,events[0].outcome.value,strictRaw,opt2,budgetRaw,undefined,events[1..],result);
      }
    } else if phase == 2 {
      if events[0].outcome.Returned? {
        NormalizeAtExtension(before,after,options,3,opt1,internRaw,events[0].outcome.value,opt2,budgetRaw,undefined,events[1..],result);
      }
    } else if phase == 3 {
      if events[0].outcome.Returned? {
        NormalizeAtExtension(before,after,options,4,opt1,internRaw,strictRaw,events[0].outcome.value,budgetRaw,undefined,events[1..],result);
      }
    } else if phase == 4 {
      if M.StrictNullish(before[opt2]) {
        NormalizeAtExtension(before,after,options,6,opt1,internRaw,strictRaw,opt2,undefined,undefined,events,result);
      } else if events[0].outcome.Returned? {
        NormalizeAtExtension(before,after,options,6,opt1,internRaw,strictRaw,opt2,events[0].outcome.value,undefined,events[1..],result);
      }
    } else if phase == 6 {
      BudgetOutcomeGuaranteesExtension(before,after,budgetRaw,
        M.StrictNullish(before[budgetRaw]),events[0].outcome,events[0].after);
    }
  }
  lemma NormalizationTraceExtension(before: map<M.Handle,M.Value>, after: map<M.Handle,M.Value>,
      options: M.Handle, undefined: M.Handle, events: seq<M.Event>, result: M.Normalized)
    requires ValuesExtend(before,after)
    requires NC.NormalizationTrace(before,options,undefined,events,result)
    ensures NC.NormalizationTrace(after,options,undefined,events,result)
  {
    TraceValuesExtension(before,after,events);
    NormalizeAtExtension(before,after,options,0,undefined,undefined,undefined,undefined,undefined,undefined,events,result);
  }
}
