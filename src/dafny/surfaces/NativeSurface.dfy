module NativeSurface {
  import opened Native
  import opened DafnyCore
  import SurfaceHost
  import opened Serializer
  import opened TagValues
  import M = SurfaceModel
  import NC = NativeContracts
  import NE = NativeErrorTextContracts
  import NT = NativeTraceLemmas
  import F = NativePrefixComposition
  import P = NativeParseTransport
  import C = NativeParseComposition
  import W = SurfaceWitness

  class Adapter {
    var engine: Engine
    var writer: Writer

    constructor() {
      engine := new Engine();
      writer := new Writer();
    }

    method NormalizeParseOptions(options: Value, ghost world: W.World,
        ghost optionsHandle: M.Handle, ghost undefinedHandle: M.Handle)
        returns (completion: Value, ghost events: seq<M.Event>,
          ghost normalized: M.Normalized)
      requires world.Valid() && world.Bound(options,optionsHandle)
      requires world.Bound(Undefined,undefinedHandle)
      requires world.values[undefinedHandle].UndefinedValue?
      requires world.contextOwner == this
      requires world.ContextProfile(engine,engine.tagHelpers,writer)
      ensures NC.NormalizationTrace(world.values, optionsHandle, undefinedHandle,
        events, normalized)
      ensures |events| > 0 && events[0].before == old(world.heap) &&
        events[|events|-1].after == world.heap
      ensures world.Valid()
      ensures world.Bound(Undefined,undefinedHandle)
      ensures (forall binding | binding in old(world.bindings) :: binding in world.bindings)
      ensures W.PreservesValues(world,old(world.values))
      ensures engine.tagHelpers == old(engine.tagHelpers)
      ensures world.contextOwner == old(world.contextOwner)
      ensures world.ContextProfile(engine,engine.tagHelpers,writer)
      ensures SurfaceHost.CompletionIsThrown(completion) == normalized.NormalizationFailure?
      ensures SurfaceHost.CompletionIsThrown(completion) ==>
        world.Bound(SurfaceHost.CompletionValue(completion),normalized.thrown)
      ensures !SurfaceHost.CompletionIsThrown(completion) ==> normalized.Ready?
      ensures !SurfaceHost.CompletionIsThrown(completion) ==>
        SurfaceHost.NormalizationStrict(SurfaceHost.CompletionValue(completion)) == normalized.strict
      ensures !SurfaceHost.CompletionIsThrown(completion) ==>
        SurfaceHost.NormalizationIntern(SurfaceHost.CompletionValue(completion)) == normalized.intern
      ensures !SurfaceHost.CompletionIsThrown(completion) ==>
        world.Bound(SurfaceHost.NormalizationBudget(
          SurfaceHost.CompletionValue(completion)),normalized.budget)
      modifies world, engine, engine.tagHelpers, writer
    {
      events := [];
      normalized := M.NormalizationFailure(undefinedHandle);
      var internStringsValue := Undefined;
      var internStringsHandle := undefinedHandle;
      var strictValue := Undefined;
      var strictHandle := undefinedHandle;
      var keyCacheBudgetValue := Undefined;
      var keyCacheBudgetHandle := undefinedHandle;
      ghost var internEvents: seq<M.Event> := [];
      ghost var firstHistory: seq<M.Event> := [];
      ghost var internHistory: seq<M.Event> := [];
      ghost var strictHistory: seq<M.Event> := [];
      ghost var secondHistory: seq<M.Event> := [];
      ghost var budgetHistory: seq<M.Event> := [];
      var internValues := false;
      var strict := false;

      if !SurfaceHost.IsNullish(options, world, optionsHandle) {
        var firstOptimizationsRead, firstOptimizationsEvent := SurfaceHost.ReadProperty(
          options, "optimizations", engine, engine.tagHelpers, writer, world, optionsHandle);
        events := events + [firstOptimizationsEvent];
        firstHistory := [firstOptimizationsEvent];
        if SurfaceHost.CompletionIsThrown(firstOptimizationsRead) {
          completion := firstOptimizationsRead;
          normalized := M.NormalizationFailure(firstOptimizationsEvent.outcome.value);
          assert NC.NormalizeAt(world.values,optionsHandle,0,
            undefinedHandle,undefinedHandle,undefinedHandle,undefinedHandle,
            undefinedHandle,undefinedHandle,[firstOptimizationsEvent],normalized);
          assert NC.NormalizationTrace(world.values,optionsHandle,undefinedHandle,events,normalized);
          return;
        }
        var firstOptimizations := SurfaceHost.CompletionValue(firstOptimizationsRead);
        var firstOptimizationsHandle := firstOptimizationsEvent.outcome.value;
        if !SurfaceHost.IsNullish(firstOptimizations, world, firstOptimizationsHandle) {
          var internStringsRead, internStringsEvent := SurfaceHost.ReadProperty(
            firstOptimizations, "internStrings", engine, engine.tagHelpers, writer,
            world, firstOptimizationsHandle);
          events := events + [internStringsEvent];
          internEvents := internEvents + [internStringsEvent];
          internHistory := [internStringsEvent];
          if SurfaceHost.CompletionIsThrown(internStringsRead) {
            completion := internStringsRead;
            normalized := M.NormalizationFailure(internStringsEvent.outcome.value);
            assert NC.NormalizeAt(world.values,optionsHandle,1,
              firstOptimizationsHandle,undefinedHandle,strictHandle,
              undefinedHandle,undefinedHandle,undefinedHandle,[internStringsEvent],normalized);
            assert NC.NormalizeAt(world.values,optionsHandle,0,
              undefinedHandle,undefinedHandle,undefinedHandle,undefinedHandle,
              undefinedHandle,undefinedHandle,
              [firstOptimizationsEvent,internStringsEvent],normalized);
            assert NC.NormalizationTrace(world.values,optionsHandle,undefinedHandle,events,normalized);
            return;
          }
          internStringsValue := SurfaceHost.CompletionValue(internStringsRead);
          internStringsHandle := internStringsEvent.outcome.value;
        }
        internValues := SurfaceHost.IsTruthy(internStringsValue, world, internStringsHandle);

        var strictRead, strictEvent := SurfaceHost.ReadProperty(
          options, "strict", engine, engine.tagHelpers, writer, world, optionsHandle);
        events := events + [strictEvent];
        strictHistory := [strictEvent];
        if SurfaceHost.CompletionIsThrown(strictRead) {
          completion := strictRead;
          normalized := M.NormalizationFailure(strictEvent.outcome.value);
          assert NC.NormalizeAt(world.values,optionsHandle,2,
            firstOptimizationsHandle,internStringsHandle,undefinedHandle,
            undefinedHandle,undefinedHandle,undefinedHandle,[strictEvent],normalized);
          if M.StrictNullish(world.values[firstOptimizationsHandle]) {
            assert NC.NormalizeAt(world.values,optionsHandle,1,
              firstOptimizationsHandle,internStringsHandle,undefinedHandle,
              undefinedHandle,undefinedHandle,undefinedHandle,[strictEvent],normalized);
            assert NC.NormalizeAt(world.values,optionsHandle,0,
              undefinedHandle,undefinedHandle,undefinedHandle,undefinedHandle,
              undefinedHandle,undefinedHandle,[firstOptimizationsEvent,strictEvent],normalized);
          } else {
            assert NC.NormalizeAt(world.values,optionsHandle,1,
              firstOptimizationsHandle,internStringsHandle,undefinedHandle,
              undefinedHandle,undefinedHandle,undefinedHandle,internEvents + [strictEvent],normalized);
            assert NC.NormalizeAt(world.values,optionsHandle,0,
              undefinedHandle,undefinedHandle,undefinedHandle,undefinedHandle,
              undefinedHandle,undefinedHandle,
              [firstOptimizationsEvent] + internEvents + [strictEvent],normalized);
          }
          return;
        }
        strictValue := SurfaceHost.CompletionValue(strictRead);
        strictHandle := strictEvent.outcome.value;
        strict := SurfaceHost.IsExactlyTrue(strictValue, world, strictHandle);

        var secondOptimizationsRead, secondOptimizationsEvent := SurfaceHost.ReadProperty(
          options, "optimizations", engine, engine.tagHelpers, writer, world, optionsHandle);
        events := events + [secondOptimizationsEvent];
        secondHistory := [secondOptimizationsEvent];
        if SurfaceHost.CompletionIsThrown(secondOptimizationsRead) {
          completion := secondOptimizationsRead;
          normalized := M.NormalizationFailure(secondOptimizationsEvent.outcome.value);
          assert NC.NormalizeAt(world.values,optionsHandle,3,
            firstOptimizationsHandle,internStringsHandle,strictHandle,
            undefinedHandle,undefinedHandle,undefinedHandle,
            [secondOptimizationsEvent],normalized);
          assert NC.NormalizeAt(world.values,optionsHandle,2,
            firstOptimizationsHandle,internStringsHandle,strictHandle,
            undefinedHandle,undefinedHandle,undefinedHandle,
            [strictEvent,secondOptimizationsEvent],normalized);
          if M.StrictNullish(world.values[firstOptimizationsHandle]) {
            assert internEvents == [];
            assert NC.NormalizeAt(world.values,optionsHandle,1,
              firstOptimizationsHandle,internStringsHandle,strictHandle,
              undefinedHandle,undefinedHandle,undefinedHandle,
              [strictEvent,secondOptimizationsEvent],normalized);
          } else {
            assert |internEvents| == 1;
            assert NC.NormalizeAt(world.values,optionsHandle,1,
              firstOptimizationsHandle,internStringsHandle,strictHandle,
              undefinedHandle,undefinedHandle,undefinedHandle,
              internEvents + [strictEvent,secondOptimizationsEvent],normalized);
          }
          assert NC.NormalizeAt(world.values,optionsHandle,0,
            undefinedHandle,undefinedHandle,undefinedHandle,undefinedHandle,
            undefinedHandle,undefinedHandle,
            [firstOptimizationsEvent] + internEvents +
              [strictEvent,secondOptimizationsEvent],normalized);
          assert events == [firstOptimizationsEvent] + internEvents +
            [strictEvent,secondOptimizationsEvent];
          assert NC.NormalizationTrace(world.values,optionsHandle,undefinedHandle,events,normalized);
          return;
        }
        var secondOptimizations := SurfaceHost.CompletionValue(secondOptimizationsRead);
        var secondOptimizationsHandle := secondOptimizationsEvent.outcome.value;
        if !SurfaceHost.IsNullish(secondOptimizations, world, secondOptimizationsHandle) {
          var budgetRead, budgetEvent := SurfaceHost.ReadProperty(
            secondOptimizations, "keyCacheMaxKb", engine, engine.tagHelpers, writer,
            world, secondOptimizationsHandle);
          events := events + [budgetEvent];
          budgetHistory := [budgetEvent];
          if SurfaceHost.CompletionIsThrown(budgetRead) {
            completion := budgetRead;
            normalized := M.NormalizationFailure(budgetEvent.outcome.value);
            assert NC.NormalizeAt(world.values,optionsHandle,4,
              firstOptimizationsHandle,internStringsHandle,strictHandle,
              secondOptimizationsHandle,undefinedHandle,undefinedHandle,
              [budgetEvent],normalized);
            assert NC.NormalizeAt(world.values,optionsHandle,3,
              firstOptimizationsHandle,internStringsHandle,strictHandle,
              undefinedHandle,undefinedHandle,undefinedHandle,
              [secondOptimizationsEvent,budgetEvent],normalized);
            assert NC.NormalizeAt(world.values,optionsHandle,2,
              firstOptimizationsHandle,internStringsHandle,strictHandle,
              undefinedHandle,undefinedHandle,undefinedHandle,
              [strictEvent,secondOptimizationsEvent,budgetEvent],normalized);
            if M.StrictNullish(world.values[firstOptimizationsHandle]) {
              assert internEvents == [];
              assert NC.NormalizeAt(world.values,optionsHandle,1,
                firstOptimizationsHandle,internStringsHandle,strictHandle,
                undefinedHandle,undefinedHandle,undefinedHandle,
                [strictEvent,secondOptimizationsEvent,budgetEvent],normalized);
            } else {
              assert |internEvents| == 1;
              assert NC.NormalizeAt(world.values,optionsHandle,1,
                firstOptimizationsHandle,internStringsHandle,strictHandle,
                undefinedHandle,undefinedHandle,undefinedHandle,
                internEvents + [strictEvent,secondOptimizationsEvent,budgetEvent],normalized);
            }
            assert NC.NormalizeAt(world.values,optionsHandle,0,
              undefinedHandle,undefinedHandle,undefinedHandle,undefinedHandle,
              undefinedHandle,undefinedHandle,
              [firstOptimizationsEvent] + internEvents +
                [strictEvent,secondOptimizationsEvent,budgetEvent],normalized);
            assert events == [firstOptimizationsEvent] + internEvents +
              [strictEvent,secondOptimizationsEvent,budgetEvent];
            assert NC.NormalizationTrace(world.values,optionsHandle,undefinedHandle,events,normalized);
            return;
          }
          keyCacheBudgetValue := SurfaceHost.CompletionValue(budgetRead);
          keyCacheBudgetHandle := budgetEvent.outcome.value;
        }
      }

      var useDefault := SurfaceHost.IsNullish(keyCacheBudgetValue, world, keyCacheBudgetHandle);
      if useDefault { keyCacheBudgetValue := NumberValue(4096); }
      assert world.Valid();
      assert keyCacheBudgetHandle in world.values;
      if !useDefault {
        assert world.Bound(keyCacheBudgetValue,keyCacheBudgetHandle);
      }
      var multiplied, multiplyEvent := SurfaceHost.MultiplyBy1024(
        keyCacheBudgetValue, engine, engine.tagHelpers, writer, world,
        keyCacheBudgetHandle, useDefault);
      events := events + [multiplyEvent];
      if SurfaceHost.CompletionIsThrown(multiplied) {
        completion := multiplied;
        normalized := M.NormalizationFailure(multiplyEvent.outcome.value);
        assert F.PrefixFacts(world.values,optionsHandle,undefinedHandle,
          firstHistory,internHistory,strictHistory,secondHistory,budgetHistory);
        assert events == firstHistory+internHistory+strictHistory+
          secondHistory+budgetHistory+[multiplyEvent];
        F.Complete(world.values,optionsHandle,undefinedHandle,
          firstHistory,internHistory,strictHistory,secondHistory,budgetHistory,
          multiplyEvent,normalized);
        assert NC.NormalizationTrace(world.values,optionsHandle,undefinedHandle,events,normalized);
        return;
      }
      var keyCacheBudget := SurfaceHost.CompletionValue(multiplied);
      var record, ready := SurfaceHost.CaptureNormalizationRecord(
        strict, internValues, keyCacheBudget, world, multiplyEvent.outcome.value);
      completion := record;
      normalized := ready;
      assert F.PrefixFacts(world.values,optionsHandle,undefinedHandle,
        firstHistory,internHistory,strictHistory,secondHistory,budgetHistory);
      assert events == firstHistory+internHistory+strictHistory+
        secondHistory+budgetHistory+[multiplyEvent];
      F.Complete(world.values,optionsHandle,undefinedHandle,
        firstHistory,internHistory,strictHistory,secondHistory,budgetHistory,
        multiplyEvent,normalized);
      assert NC.NormalizationTrace(world.values,optionsHandle,undefinedHandle,events,normalized);
    }

    method SelectCompletionAfterCleanup(pending: Value, cleanup: Value,
        cleanupThrown: bool) returns (result: Value)
      ensures result == (if cleanupThrown then cleanup else pending)
    {
      if cleanupThrown { result := cleanup; }
      else { result := pending; }
    }

    method Parse(text: string, options: Value, ghost world: W.World,
        ghost writerContext: Writer,
        ghost textHandle: M.Handle, ghost optionsHandle: M.Handle,
        ghost undefinedHandle: M.Handle)
      returns (completion: Value, ghost events: seq<M.Event>,
        ghost modeledOutcome: M.Outcome)
      requires W.ParseEntry(world,text,StringValue(text),textHandle,
        options,optionsHandle,undefinedHandle)
      requires writerContext == writer
      requires world.contextOwner == this
      requires world.ContextProfile(engine,engine.tagHelpers,writer)
      ensures NC.NativeParseCompletion(world.values,textHandle,optionsHandle,
        undefinedHandle,false,events,modeledOutcome)
      ensures world.Bound(SurfaceHost.CompletionValue(completion),modeledOutcome.value)
      ensures modeledOutcome.Thrown? == SurfaceHost.CompletionIsThrown(completion)
      ensures |events| > 0 && events[0].before == old(world.heap) &&
        events[|events|-1].after == world.heap
      ensures (forall binding | binding in old(world.bindings) :: binding in world.bindings)
      ensures W.PreservesValues(world,old(world.values))
      ensures world.Valid()
      ensures world.contextOwner == old(world.contextOwner)
      ensures world.ContextProfile(engine,engine.tagHelpers,writer)
      modifies world, engine, engine.tagHelpers, writer, writerContext
    {
      completion, events, modeledOutcome := ParseCompletion(text, options, false,
        writerContext,
        world,textHandle,optionsHandle,undefinedHandle);
    }

    method ParseAll(text: string, options: Value, ghost world: W.World,
        ghost writerContext: Writer,
        ghost textHandle: M.Handle, ghost optionsHandle: M.Handle,
        ghost undefinedHandle: M.Handle)
      returns (completion: Value, ghost events: seq<M.Event>,
        ghost modeledOutcome: M.Outcome)
      requires W.ParseEntry(world,text,StringValue(text),textHandle,
        options,optionsHandle,undefinedHandle)
      requires writerContext == writer
      requires world.contextOwner == this
      requires world.ContextProfile(engine,engine.tagHelpers,writer)
      ensures NC.NativeParseCompletion(world.values,textHandle,optionsHandle,
        undefinedHandle,true,events,modeledOutcome)
      ensures world.Bound(SurfaceHost.CompletionValue(completion),modeledOutcome.value)
      ensures modeledOutcome.Thrown? == SurfaceHost.CompletionIsThrown(completion)
      ensures |events| > 0 && events[0].before == old(world.heap) &&
        events[|events|-1].after == world.heap
      ensures (forall binding | binding in old(world.bindings) :: binding in world.bindings)
      ensures W.PreservesValues(world,old(world.values))
      ensures world.Valid()
      ensures world.contextOwner == old(world.contextOwner)
      ensures world.ContextProfile(engine,engine.tagHelpers,writer)
      modifies world, engine, engine.tagHelpers, writer, writerContext
    {
      completion, events, modeledOutcome := ParseCompletion(text, options, true,
        writerContext,
        world,textHandle,optionsHandle,undefinedHandle);
    }

    method ParseCompletion(text: string, options: Value, allDocuments: bool,
        ghost writerContext: Writer,
        ghost world: W.World, ghost textHandle: M.Handle,
        ghost optionsHandle: M.Handle, ghost undefinedHandle: M.Handle)
      returns (completion: Value, ghost events: seq<M.Event>,
        ghost modeledOutcome: M.Outcome)
      requires W.ParseEntry(world,text,StringValue(text),textHandle,
        options,optionsHandle,undefinedHandle)
      requires writerContext == writer
      requires world.contextOwner == this
      requires world.ContextProfile(engine,engine.tagHelpers,writer)
      ensures NC.NativeParseCompletion(world.values,textHandle,optionsHandle,
        undefinedHandle,allDocuments,events,modeledOutcome)
      ensures world.Bound(SurfaceHost.CompletionValue(completion),modeledOutcome.value)
      ensures modeledOutcome.Thrown? == SurfaceHost.CompletionIsThrown(completion)
      ensures |events| > 0 && events[0].before == old(world.heap) &&
        events[|events|-1].after == world.heap
      ensures (forall binding | binding in old(world.bindings) :: binding in world.bindings)
      ensures W.PreservesValues(world,old(world.values))
      ensures world.Valid()
      ensures world.contextOwner == old(world.contextOwner)
      ensures world.ContextProfile(engine,engine.tagHelpers,writer)
      modifies world, engine, engine.tagHelpers, writer, writerContext
    {
      ghost var entryValues := world.values;
      ghost var entryBindings := world.bindings;
      var pending, normalizationEvents, normalizationState := NormalizeParseOptions(
        options,world,optionsHandle,undefinedHandle);
      events := normalizationEvents;
      ghost var normalizationValues := world.values;
      ghost var currentValues := world.values;
      ghost var currentBindings := world.bindings;
      ghost var resets: seq<M.Event> := [];
      ghost var parses: seq<M.Event> := [];
      ghost var guards: seq<M.Event> := [];
      assert M.TraceLinked(normalizationEvents);
      assert M.TraceValues(normalizationValues,normalizationEvents);
      assert NT.ValuesExtend(entryValues,normalizationValues);
      assert NT.BindingsExtend(entryBindings,currentBindings);
      var pendingModeled := if normalizationState.NormalizationFailure? then
        M.Thrown(normalizationState.thrown) else M.Returned(normalizationState.budget);
      if !SurfaceHost.CompletionIsThrown(pending) {
        var normalizationRecord := SurfaceHost.CompletionValue(pending);
        var strict := SurfaceHost.NormalizationStrict(normalizationRecord);
        var intern := SurfaceHost.NormalizationIntern(normalizationRecord);
        var budget := SurfaceHost.NormalizationBudget(normalizationRecord);
        var budgetHandle := normalizationState.budget;
        assert world.Valid();
        assert world.Bound(budget,budgetHandle);
        ghost var resetInputValues := world.values;
        ghost var resetInputBindings := world.bindings;
        ghost var resetInputHeap := world.heap;
        var reset, resetEvent := SurfaceHost.CaptureReset(engine, writerContext, text, strict, intern,
          budget,world,textHandle,budgetHandle);
        resets := [resetEvent];
        assert resetEvent.before == resetInputHeap;
        assert resetEvent.after == world.heap;
        assert NT.ValuesExtend(resetInputValues,world.values);
        NT.ValuesExtendTransitive(normalizationValues,currentValues,resetInputValues);
        NT.ValuesExtendTransitive(normalizationValues,resetInputValues,world.values);
        NT.BindingsExtendTransitive(entryBindings,currentBindings,resetInputBindings);
        NT.BindingsExtendTransitive(entryBindings,resetInputBindings,world.bindings);
        NT.TraceValuesExtension(currentValues,resetInputValues,events);
        NT.TraceValuesExtension(resetInputValues,world.values,events);
        NT.TraceAppend(world.values,events,resetEvent);
        events := events + [resetEvent];
        currentValues := world.values;
        currentBindings := world.bindings;
        pending := reset;
        pendingModeled := resetEvent.outcome;
        if !SurfaceHost.CompletionIsThrown(pending) {
          var parsed: Value;
          ghost var parseEvent: M.Event;
          ghost var parseInputValues := world.values;
          ghost var parseInputBindings := world.bindings;
          ghost var parseInputHeap := world.heap;
          if allDocuments {
            parsed, parseEvent := SurfaceHost.CaptureParseAll(engine,writerContext,world);
          } else {
            parsed, parseEvent := SurfaceHost.CaptureParseSingle(engine,writerContext,world);
          }
          parses := [parseEvent];
          assert parseEvent.before == parseInputHeap;
          assert parseEvent.after == world.heap;
          assert NT.ValuesExtend(parseInputValues,world.values);
          NT.ValuesExtendTransitive(normalizationValues,currentValues,parseInputValues);
          NT.ValuesExtendTransitive(normalizationValues,parseInputValues,world.values);
          NT.BindingsExtendTransitive(entryBindings,currentBindings,parseInputBindings);
          NT.BindingsExtendTransitive(entryBindings,parseInputBindings,world.bindings);
          NT.TraceValuesExtension(currentValues,parseInputValues,events);
          NT.TraceValuesExtension(parseInputValues,world.values,events);
          NT.TraceAppend(world.values,events,parseEvent);
          assert |events| == 0 || events[|events|-1].after == parseEvent.before;
          NT.TraceLinkedConcat(events,[parseEvent]);
          events := events + [parseEvent];
          currentValues := world.values;
          currentBindings := world.bindings;
          pending := parsed;
          pendingModeled := parseEvent.outcome;
          if allDocuments && !SurfaceHost.CompletionIsThrown(pending) {
            var value := SurfaceHost.CompletionValue(pending);
            var valueHandle := parseEvent.outcome.value;
            ghost var arrayInputValues := world.values;
            ghost var arrayInputBindings := world.bindings;
            ghost var arrayInputHeap := world.heap;
            var arrayCheck, arrayEvent := SurfaceHost.CaptureIsArray(value, engine,
              engine.tagHelpers, writer,world,valueHandle);
            guards := [arrayEvent];
            assert arrayEvent.before == arrayInputHeap;
            assert arrayEvent.after == world.heap;
            assert NT.ValuesExtend(arrayInputValues,world.values);
            NT.ValuesExtendTransitive(normalizationValues,currentValues,arrayInputValues);
            NT.ValuesExtendTransitive(normalizationValues,arrayInputValues,world.values);
            NT.BindingsExtendTransitive(entryBindings,currentBindings,arrayInputBindings);
            NT.BindingsExtendTransitive(entryBindings,arrayInputBindings,world.bindings);
            NT.TraceValuesExtension(currentValues,arrayInputValues,events);
            NT.TraceValuesExtension(arrayInputValues,world.values,events);
            NT.TraceAppend(world.values,events,arrayEvent);
            assert |events| == 0 || events[|events|-1].after == arrayEvent.before;
            NT.TraceLinkedConcat(events,[arrayEvent]);
            events := events + [arrayEvent];
            currentValues := world.values;
            currentBindings := world.bindings;
            if SurfaceHost.CompletionIsThrown(arrayCheck) {
              pending := arrayCheck;
              pendingModeled := arrayEvent.outcome;
            } else if !SurfaceHost.IsTruthy(SurfaceHost.CompletionValue(arrayCheck),
                world,arrayEvent.outcome.value) {
              ghost var errorInputValues := world.values;
              ghost var errorInputBindings := world.bindings;
              ghost var errorInputHeap := world.heap;
              var typeError, typeErrorEvent := SurfaceHost.CaptureTypeError(
                "Dafny parseAll returned a non-array value", engine,
                engine.tagHelpers, writer,world);
              guards := guards + [typeErrorEvent];
              assert typeErrorEvent.before == errorInputHeap;
              assert typeErrorEvent.after == world.heap;
              assert NT.ValuesExtend(errorInputValues,world.values);
              NT.ValuesExtendTransitive(normalizationValues,currentValues,errorInputValues);
              NT.ValuesExtendTransitive(normalizationValues,errorInputValues,world.values);
              NT.BindingsExtendTransitive(entryBindings,currentBindings,errorInputBindings);
              NT.BindingsExtendTransitive(entryBindings,errorInputBindings,world.bindings);
              NT.TraceValuesExtension(currentValues,errorInputValues,events);
              NT.TraceValuesExtension(errorInputValues,world.values,events);
              NT.TraceAppend(world.values,events,typeErrorEvent);
              assert |events| == 0 || events[|events|-1].after == typeErrorEvent.before;
              NT.TraceLinkedConcat(events,[typeErrorEvent]);
              events := events + [typeErrorEvent];
              currentValues := world.values;
              currentBindings := world.bindings;
              pending := typeError;
              pendingModeled := typeErrorEvent.outcome;
            }
          }
        }
      }

      ghost var middle := resets+parses+guards;
      ghost var middleValues := world.values;
      assert events == normalizationEvents+middle;
      if normalizationState.NormalizationFailure? {
        assert resets == [] && parses == [] && guards == [];
        C.NormalizeFailed(middleValues,textHandle,allDocuments,normalizationState);
      } else {
        assert |resets| == 1;
        var resetObservation := resets[0];
        if resetObservation.outcome.Thrown? {
          assert parses == [] && guards == [];
          C.ResetFailed(middleValues,textHandle,allDocuments,normalizationState,
            resetObservation);
        } else {
          assert |parses| == 1;
          var parseObservation := parses[0];
          if !allDocuments {
            assert guards == [];
            C.SingleParsed(middleValues,textHandle,normalizationState,
              resetObservation,parseObservation);
          } else {
            if parseObservation.outcome.Thrown? {
              assert guards == [];
              C.ArraySkip(middleValues,parseObservation.outcome);
            } else {
              assert |guards| >= 1;
              var arrayObservation := guards[0];
              if arrayObservation.outcome.Thrown? ||
                  M.Truthy(middleValues[arrayObservation.outcome.value]) {
                assert guards[1..] == [];
              } else {
                assert |guards| == 2;
                assert guards[1].operation == M.NewTypeError(
                  "Dafny parseAll returned a non-array value");
              }
              C.ArrayHead(middleValues,parseObservation.outcome,arrayObservation,
                guards[1..],pendingModeled);
            }
            C.AllParsed(middleValues,textHandle,normalizationState,resetObservation,
              parseObservation,guards,pendingModeled);
          }
        }
      }
      assert NC.AfterNormalization(middleValues,textHandle,allDocuments,
        normalizationState,middle,pendingModeled);
      assert world.Bound(SurfaceHost.CompletionValue(pending),pendingModeled.value);
      assert pendingModeled.Thrown? == SurfaceHost.CompletionIsThrown(pending);
      ghost var pendingBindings := world.bindings;
      ghost var pendingValue := SurfaceHost.CompletionValue(pending);
      ghost var pendingHandle := pendingModeled.value;
      ghost var cleanupInputValues := world.values;
      ghost var cleanupInputBindings := world.bindings;
      ghost var cleanupInputHeap := world.heap;
      assert middleValues == cleanupInputValues;
      var cleanup, cleanupEvent := SurfaceHost.CaptureEndStream(engine,writerContext,world);
      assert world.ContextProfile(engine,engine.tagHelpers,writerContext);
      assert writer == writerContext;
      assert world.contextOwner == old(world.contextOwner);
      assert world.ContextProfile(engine,engine.tagHelpers,writer);
      assert cleanupEvent.before == cleanupInputHeap;
      assert cleanupEvent.after == world.heap;
      assert NT.ValuesExtend(cleanupInputValues,world.values);
      NT.ValuesExtendTransitive(normalizationValues,currentValues,cleanupInputValues);
      NT.ValuesExtendTransitive(normalizationValues,cleanupInputValues,world.values);
      NT.BindingsExtendTransitive(entryBindings,currentBindings,cleanupInputBindings);
      NT.BindingsExtendTransitive(entryBindings,cleanupInputBindings,world.bindings);
      NT.TraceValuesExtension(currentValues,cleanupInputValues,events);
      NT.TraceValuesExtension(cleanupInputValues,world.values,events);
      NT.TraceAppend(world.values,events,cleanupEvent);
      assert |events| == 0 || events[|events|-1].after == cleanupEvent.before;
      NT.TraceLinkedConcat(events,[cleanupEvent]);
      if !SurfaceHost.CompletionIsThrown(cleanup) {
        NT.BoundTransport(pendingBindings,world,pendingValue,pendingHandle);
      }
      events := events + [cleanupEvent];
      currentValues := world.values;
      currentBindings := world.bindings;
      completion := SelectCompletionAfterCleanup(
        pending,cleanup,SurfaceHost.CompletionIsThrown(cleanup));
      if SurfaceHost.CompletionIsThrown(cleanup) {
        modeledOutcome := cleanupEvent.outcome;
      } else {
        modeledOutcome := pendingModeled;
      }
      assert events == normalizationEvents+middle+[cleanupEvent];
      assert M.TraceLinked(events) && M.TraceValues(world.values,events);
      P.AfterNormalizationExtension(middleValues,world.values,textHandle,
        allDocuments,normalizationState,middle,pendingModeled);
      NT.NormalizationTraceExtension(normalizationValues,world.values,
        optionsHandle,undefinedHandle,normalizationEvents,normalizationState);
      C.Finish(world.values,textHandle,optionsHandle,undefinedHandle,allDocuments,
        normalizationEvents,normalizationState,middle,pendingModeled,cleanupEvent);
      assert modeledOutcome == (if cleanupEvent.outcome.Thrown? then
        cleanupEvent.outcome else pendingModeled);
    }

    method Stringify(value: Value, ghost world: W.World,
        ghost argumentHandle: M.Handle)
      returns (completion: Value, ghost events: seq<M.Event>,
        ghost modeledOutcome: M.Outcome)
      requires world.Valid() && world.Bound(value,argumentHandle)
      requires world.contextOwner == this
      requires world.ContextProfile(engine,engine.tagHelpers,writer)
      ensures NC.NativeStringifyCompletion(world.values,argumentHandle,events,modeledOutcome)
      ensures world.Bound(SurfaceHost.CompletionValue(completion),modeledOutcome.value)
      ensures modeledOutcome.Thrown? == SurfaceHost.CompletionIsThrown(completion)
      ensures |events| > 0 && events[0].before == old(world.heap) &&
        events[|events|-1].after == world.heap
      ensures (forall binding | binding in old(world.bindings) :: binding in world.bindings)
      ensures W.PreservesValues(world,old(world.values))
      ensures world.Valid()
      ensures world.contextOwner == old(world.contextOwner)
      ensures world.ContextProfile(engine,engine.tagHelpers,writer)
      modifies world, engine, engine.tagHelpers, writer
    {
      var written, stringifyEvent := SurfaceHost.CaptureWriterStringify(
        writer, value, engine, engine.tagHelpers, world,argumentHandle);
      events := [stringifyEvent];
      if SurfaceHost.CompletionIsThrown(written) {
        completion := written;
        modeledOutcome := stringifyEvent.outcome;
        return;
      }
      var text := SurfaceHost.CompletionValue(written);
      if !SurfaceHost.IsString(text,world,stringifyEvent.outcome.value) {
        var typeError, typeErrorEvent := SurfaceHost.CaptureTypeError(
          "Dafny stringify returned a non-string value", engine,
          engine.tagHelpers, writer,world);
        events := events + [typeErrorEvent];
        completion := typeError;
        modeledOutcome := typeErrorEvent.outcome;
        return;
      }
      completion := written;
      modeledOutcome := stringifyEvent.outcome;
    }

    method ExceptionToString(receiver: Value, ghost world: W.World,
        ghost receiverHandle: M.Handle)
      returns (completion: Value, ghost events: seq<M.Event>,
        ghost modeledOutcome: M.Outcome)
      requires world.Valid() && world.Bound(receiver,receiverHandle)
      requires world.contextOwner == this
      requires world.ContextProfile(engine,engine.tagHelpers,writer)
      ensures NE.ExceptionToString(world.values,receiverHandle,events,modeledOutcome)
      ensures world.Valid()
      ensures world.Bound(SurfaceHost.CompletionValue(completion),modeledOutcome.value)
      ensures modeledOutcome.Thrown? == SurfaceHost.CompletionIsThrown(completion)
      ensures |events| > 0 && events[0].before == old(world.heap)
      ensures events[|events|-1].after == world.heap
      ensures W.PreservesValues(world,old(world.values))
      ensures (forall binding | binding in old(world.bindings) :: binding in world.bindings)
      ensures world.contextOwner == old(world.contextOwner)
      ensures world.ContextProfile(engine,engine.tagHelpers,writer)
      modifies world, engine, engine.tagHelpers, writer
    {
      events := [];
      var nameRead, nameReadEvent := SurfaceHost.ReadProperty(receiver, "name",
        engine, engine.tagHelpers, writer,world,receiverHandle);
      events := events + [nameReadEvent];
      if SurfaceHost.CompletionIsThrown(nameRead) {
        completion := nameRead;
        modeledOutcome := nameReadEvent.outcome;
        return;
      }
      var nameText, nameTextEvent := SurfaceHost.TemplateString(
        SurfaceHost.CompletionValue(nameRead), engine, engine.tagHelpers, writer,
        world,nameReadEvent.outcome.value);
      events := events + [nameTextEvent];
      if SurfaceHost.CompletionIsThrown(nameText) {
        completion := nameText;
        modeledOutcome := nameTextEvent.outcome;
        return;
      }

      var messageRead, messageReadEvent := SurfaceHost.ReadProperty(receiver, "message",
        engine, engine.tagHelpers, writer,world,receiverHandle);
      events := events + [messageReadEvent];
      if SurfaceHost.CompletionIsThrown(messageRead) {
        completion := messageRead;
        modeledOutcome := messageReadEvent.outcome;
        return;
      }
      var messageText, messageTextEvent := SurfaceHost.TemplateString(
        SurfaceHost.CompletionValue(messageRead), engine, engine.tagHelpers, writer,
        world,messageReadEvent.outcome.value);
      events := events + [messageTextEvent];
      if SurfaceHost.CompletionIsThrown(messageText) {
        completion := messageText;
        modeledOutcome := messageTextEvent.outcome;
        return;
      }

      ghost var outputHandle: M.Handle;
      completion, outputHandle := SurfaceHost.ReturnedString(
        Native.Concat(
          Native.Concat(Native.StringValueOf(SurfaceHost.CompletionValue(nameText)), ": "),
          Native.StringValueOf(SurfaceHost.CompletionValue(messageText))),world);
      modeledOutcome := M.Returned(outputHandle);
    }

    method NotImplementedMessage(functionName: Value, ghost world: W.World,
        ghost functionNameHandle: M.Handle)
      returns (completion: Value, ghost events: seq<M.Event>,
        ghost modeledOutcome: M.Outcome)
      requires world.Valid() && world.Bound(functionName,functionNameHandle)
      requires world.contextOwner == this
      requires world.ContextProfile(engine,engine.tagHelpers,writer)
      ensures NE.NotImplementedMessage(world.values,functionNameHandle,events,modeledOutcome)
      ensures world.Valid()
      ensures world.Bound(SurfaceHost.CompletionValue(completion),modeledOutcome.value)
      ensures modeledOutcome.Thrown? == SurfaceHost.CompletionIsThrown(completion)
      ensures |events| > 0 && events[0].before == old(world.heap)
      ensures events[|events|-1].after == world.heap
      ensures W.PreservesValues(world,old(world.values))
      ensures (forall binding | binding in old(world.bindings) :: binding in world.bindings)
      ensures world.contextOwner == old(world.contextOwner)
      ensures world.ContextProfile(engine,engine.tagHelpers,writer)
      modifies world, engine, engine.tagHelpers, writer
    {
      var converted, conversionEvent := SurfaceHost.TemplateString(functionName,
        engine, engine.tagHelpers, writer,world,functionNameHandle);
      events := [conversionEvent];
      if SurfaceHost.CompletionIsThrown(converted) {
        completion := converted;
        modeledOutcome := conversionEvent.outcome;
        return;
      }
      var nameText := Native.StringValueOf(SurfaceHost.CompletionValue(converted));
      ghost var outputHandle: M.Handle;
      completion, outputHandle := SurfaceHost.ReturnedString(
        Native.Concat(
          Native.Concat("lightning-yaml ", nameText),
          "() is not implemented yet — this is the stub the benchmark + test harness is built against. See src/index.ts."),world);
      modeledOutcome := M.Returned(outputHandle);
    }
  }
}
