module NativeParseTransport {
  import opened SurfaceModel
  import NC = NativeContracts
  import T = NativeTraceLemmas

  lemma ArrayGuardExtension(before: map<Handle,Value>, after: map<Handle,Value>,
      input: Outcome, events: seq<Event>, output: Outcome)
    requires T.ValuesExtend(before,after)
    requires NC.ArrayGuard(before,input,events,output)
    ensures NC.ArrayGuard(after,input,events,output)
  {
    if input.Returned? {
      if events[0].outcome.Returned? {
        assert events[0].outcome.value in before;
        assert after[events[0].outcome.value] == before[events[0].outcome.value];
      }
    }
  }

  lemma AfterNormalizationExtension(before: map<Handle,Value>, after: map<Handle,Value>,
      text: Handle, all: bool, normalized: Normalized,
      events: seq<Event>, pending: Outcome)
    requires T.ValuesExtend(before,after)
    requires NC.AfterNormalization(before,text,all,normalized,events,pending)
    ensures NC.AfterNormalization(after,text,all,normalized,events,pending)
  {
    if normalized.Ready? && events[0].outcome.Returned? && all {
      ArrayGuardExtension(before,after,events[1].outcome,events[2..],pending);
    }
  }
}
