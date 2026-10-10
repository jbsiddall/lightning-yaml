module NativePrefixComposition {
  import opened SurfaceModel
  import NC = NativeContracts
  import I = NativePhaseIntro
  import NB = NativeBudgetContracts

  ghost function Pick(es: seq<Event>, undefined: Handle): Handle reads {} {
    if |es| == 0 then undefined else es[0].outcome.value
  }
  ghost predicate ReadOk(values: map<Handle, Value>, es: seq<Event>,
      target: Handle, key: string) reads {} {
    |es| == 1 && es[0].operation == ReadProperty(target, key) &&
    es[0].outcome.Returned? && es[0].outcome.value in values
  }
  ghost predicate PrefixFacts(values: map<Handle, Value>, options: Handle,
      undefined: Handle, first: seq<Event>, intern: seq<Event>,
      strict: seq<Event>, second: seq<Event>, budget: seq<Event>) reads {} {
    ValuesValid(values) && options in values && undefined in values &&
    values[undefined].UndefinedValue? &&
    (if StrictNullish(values[options]) then (
      first == [] && intern == [] && strict == [] && second == [] && budget == []
    ) else (
      ReadOk(values, first, options, "optimizations") &&
      (if StrictNullish(values[Pick(first,undefined)]) then (intern == [])
       else (ReadOk(values, intern, Pick(first,undefined), "internStrings"))) &&
      ReadOk(values, strict, options, "strict") &&
      ReadOk(values, second, options, "optimizations") &&
      (if StrictNullish(values[Pick(second,undefined)]) then (budget == [])
       else (ReadOk(values, budget, Pick(second,undefined), "keyCacheMaxKb")))
    ))
  }

  lemma {:isolate_assertions} Complete(values: map<Handle, Value>, options: Handle,
      undefined: Handle, first: seq<Event>, intern: seq<Event>, strict: seq<Event>,
      second: seq<Event>, budget: seq<Event>, multiply: Event, result: Normalized)
    requires PrefixFacts(values,options,undefined,first,intern,strict,second,budget)
    requires multiply.operation == MultiplyBudget(Pick(budget,undefined),
      StrictNullish(values[Pick(budget,undefined)]))
    requires multiply.outcome.value in values
    requires result == (if multiply.outcome.Thrown? then NormalizationFailure(multiply.outcome.value)
      else Ready(ExactlyTrue(values[Pick(strict,undefined)]),
        Truthy(values[Pick(intern,undefined)]),multiply.outcome.value))
    requires NB.BudgetOutcomeGuarantees(values,Pick(budget,undefined),
      StrictNullish(values[Pick(budget,undefined)]),multiply.outcome,multiply.after)
    ensures NC.NormalizeAt(values,options,0,undefined,undefined,undefined,
      undefined,undefined,undefined,first+intern+strict+second+budget+[multiply],result)
  {
    var firstOptimizationsHandle := Pick(first,undefined);
    var internStringsHandle := Pick(intern,undefined);
    var strictHandle := Pick(strict,undefined);
    var secondOptimizationsHandle := Pick(second,undefined);
    var budgetHandle := Pick(budget,undefined);
    if first != [] {
      assert |first| == 1;
      assert firstOptimizationsHandle == first[0].outcome.value;
    }
    I.MultiplyLeaf(values,options,firstOptimizationsHandle,internStringsHandle,strictHandle,secondOptimizationsHandle,budgetHandle,undefined,multiply,result);
    if StrictNullish(values[options]) {
      assert first == [] && intern == [] && strict == [] && second == [] && budget == [];
      assert firstOptimizationsHandle == undefined && internStringsHandle == undefined && strictHandle == undefined && secondOptimizationsHandle == undefined && budgetHandle == undefined;
      I.SkipAbsentOptions(values,options,undefined,undefined,undefined,undefined,undefined,
        undefined,[multiply],result);
    } else {
      assert ReadOk(values,first,options,"optimizations");
      assert ReadOk(values,strict,options,"strict");
      assert ReadOk(values,second,options,"optimizations");
      assert first == [first[0]];
      assert strict == [strict[0]];
      assert second == [second[0]];
      assert firstOptimizationsHandle == first[0].outcome.value;
      assert strictHandle == strict[0].outcome.value;
      assert secondOptimizationsHandle == second[0].outcome.value;
      ghost var tail4 := budget+[multiply];
      if StrictNullish(values[secondOptimizationsHandle]) {
        assert budget == [] && budgetHandle == undefined;
        I.SkipAbsentBudgetOptimizations(values,options,firstOptimizationsHandle,internStringsHandle,strictHandle,secondOptimizationsHandle,undefined,undefined,[multiply],result);
      } else {
        assert ReadOk(values,budget,secondOptimizationsHandle,"keyCacheMaxKb");
        assert budget == [budget[0]];
        assert budgetHandle == budget[0].outcome.value;
        I.PrependBudgetRead(values,options,firstOptimizationsHandle,internStringsHandle,strictHandle,secondOptimizationsHandle,undefined,undefined,budget[0],[multiply],result);
      }
      assert NC.NormalizeAt(values,options,4,firstOptimizationsHandle,internStringsHandle,strictHandle,secondOptimizationsHandle,undefined,undefined,tail4,result);
      ghost var tail3 := second+tail4;
      I.PrependSecondOptimizationsRead(values,options,firstOptimizationsHandle,internStringsHandle,strictHandle,undefined,undefined,undefined,
        second[0],tail4,result);
      assert NC.NormalizeAt(values,options,3,firstOptimizationsHandle,internStringsHandle,strictHandle,undefined,undefined,undefined,tail3,result);
      ghost var tail2 := strict+tail3;
      I.PrependStrictRead(values,options,firstOptimizationsHandle,internStringsHandle,undefined,undefined,undefined,undefined,
        strict[0],tail3,result);
      assert NC.NormalizeAt(values,options,2,firstOptimizationsHandle,internStringsHandle,undefined,undefined,undefined,undefined,tail2,result);
      ghost var tail1 := intern+tail2;
      if StrictNullish(values[firstOptimizationsHandle]) {
        assert intern == [] && internStringsHandle == undefined;
        assert tail1 == tail2;
        I.SkipAbsentFirstOptimizations(values,options,firstOptimizationsHandle,undefined,undefined,undefined,undefined,undefined,
          tail2,result);
        assert NC.NormalizeAt(values,options,1,firstOptimizationsHandle,undefined,undefined,undefined,
          undefined,undefined,tail1,result);
      } else {
        assert ReadOk(values,intern,firstOptimizationsHandle,"internStrings");
        assert intern == [intern[0]];
        assert internStringsHandle == intern[0].outcome.value;
        I.PrependInternStringsRead(values,options,firstOptimizationsHandle,undefined,undefined,undefined,undefined,undefined,
          intern[0],tail2,result);
        assert tail1 == [intern[0]]+tail2;
        assert NC.NormalizeAt(values,options,1,firstOptimizationsHandle,undefined,undefined,undefined,
          undefined,undefined,tail1,result);
      }
      assert firstOptimizationsHandle == first[0].outcome.value;
      assert NC.NormalizeAt(values,options,1,first[0].outcome.value,undefined,
        undefined,undefined,undefined,undefined,tail1,result);
      I.PrependFirstOptimizationsRead(values,options,undefined,undefined,undefined,undefined,undefined,undefined,
        first[0],tail1,result);
      assert [first[0]]+tail1 == first+intern+strict+second+budget+[multiply];
    }
  }
}
