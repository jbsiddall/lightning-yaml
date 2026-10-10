module NativeSurface {
  import opened Native
  import opened DafnyCore
  import SurfaceHost
  import opened Serializer
  import opened TagValues

  class Adapter {
    var engine: Engine
    var writer: Writer

    constructor() {
      engine := new Engine();
      writer := new Writer();
    }

    method NormalizeParseOptions(options: Value) returns (completion: Value)
      modifies engine, engine.tagHelpers, writer
    {
      var internStringsValue := Undefined;
      var strictValue := Undefined;
      var keyCacheBudgetValue := Undefined;
      var internValues := false;
      var strict := false;

      if !SurfaceHost.IsNullish(options) {
        var firstOptimizationsRead := SurfaceHost.ReadProperty(options, "optimizations", engine, engine.tagHelpers, writer);
        if SurfaceHost.CompletionIsThrown(firstOptimizationsRead) {
          completion := firstOptimizationsRead;
          return;
        }
        var firstOptimizations := SurfaceHost.CompletionValue(firstOptimizationsRead);
        if !SurfaceHost.IsNullish(firstOptimizations) {
          var internStringsRead := SurfaceHost.ReadProperty(firstOptimizations, "internStrings", engine, engine.tagHelpers, writer);
          if SurfaceHost.CompletionIsThrown(internStringsRead) {
            completion := internStringsRead;
            return;
          }
          internStringsValue := SurfaceHost.CompletionValue(internStringsRead);
        }
        internValues := SurfaceHost.IsTruthy(internStringsValue);

        var strictRead := SurfaceHost.ReadProperty(options, "strict", engine, engine.tagHelpers, writer);
        if SurfaceHost.CompletionIsThrown(strictRead) {
          completion := strictRead;
          return;
        }
        strictValue := SurfaceHost.CompletionValue(strictRead);
        strict := SurfaceHost.IsExactlyTrue(strictValue);

        var secondOptimizationsRead := SurfaceHost.ReadProperty(options, "optimizations", engine, engine.tagHelpers, writer);
        if SurfaceHost.CompletionIsThrown(secondOptimizationsRead) {
          completion := secondOptimizationsRead;
          return;
        }
        var secondOptimizations := SurfaceHost.CompletionValue(secondOptimizationsRead);
        if !SurfaceHost.IsNullish(secondOptimizations) {
          var budgetRead := SurfaceHost.ReadProperty(secondOptimizations, "keyCacheMaxKb", engine, engine.tagHelpers, writer);
          if SurfaceHost.CompletionIsThrown(budgetRead) {
            completion := budgetRead;
            return;
          }
          keyCacheBudgetValue := SurfaceHost.CompletionValue(budgetRead);
        }
      }

      if SurfaceHost.IsNullish(keyCacheBudgetValue) { keyCacheBudgetValue := NumberValue(4096); }
      var multiplied := SurfaceHost.MultiplyBy1024(keyCacheBudgetValue, engine, engine.tagHelpers, writer);
      if SurfaceHost.CompletionIsThrown(multiplied) {
        completion := multiplied;
        return;
      }
      var keyCacheBudget := SurfaceHost.CompletionValue(multiplied);
      completion := SurfaceHost.CaptureNormalizationRecord(strict, internValues, keyCacheBudget);
    }

    method SelectCompletionAfterCleanup(pending: Value, cleanup: Value,
        cleanupThrown: bool) returns (result: Value)
      ensures result == (if cleanupThrown then cleanup else pending)
    {
      if cleanupThrown { result := cleanup; }
      else { result := pending; }
    }

    method Parse(text: string, options: Value) returns (completion: Value)
      modifies engine, engine.tagHelpers, writer
    {
      completion := ParseCompletion(text, options, false);
    }

    method ParseAll(text: string, options: Value) returns (completion: Value)
      modifies engine, engine.tagHelpers, writer
    {
      completion := ParseCompletion(text, options, true);
    }

    method ParseCompletion(text: string, options: Value, allDocuments: bool)
        returns (completion: Value)
      modifies engine, engine.tagHelpers, writer
    {
      var pending := NormalizeParseOptions(options);
      if !SurfaceHost.CompletionIsThrown(pending) {
        var normalized := SurfaceHost.CompletionValue(pending);
        var strict := SurfaceHost.NormalizationStrict(normalized);
        var intern := SurfaceHost.NormalizationIntern(normalized);
        var budget := SurfaceHost.NormalizationBudget(normalized);
        pending := SurfaceHost.CaptureReset(engine, text, strict, intern, budget);
        if !SurfaceHost.CompletionIsThrown(pending) {
          if allDocuments { pending := SurfaceHost.CaptureParseAll(engine); }
          else { pending := SurfaceHost.CaptureParseSingle(engine); }
          if allDocuments && !SurfaceHost.CompletionIsThrown(pending) {
            var value := SurfaceHost.CompletionValue(pending);
            var arrayCheck := SurfaceHost.CaptureIsArray(value, engine, engine.tagHelpers, writer);
            if SurfaceHost.CompletionIsThrown(arrayCheck) {
              pending := arrayCheck;
            } else if !SurfaceHost.IsTruthy(SurfaceHost.CompletionValue(arrayCheck)) {
              pending := SurfaceHost.CaptureTypeError(
                "Dafny parseAll returned a non-array value", engine, engine.tagHelpers, writer);
            }
          }
        }
      }

      var cleanup := SurfaceHost.CaptureEndStream(engine);
      completion := SelectCompletionAfterCleanup(
        pending, cleanup, SurfaceHost.CompletionIsThrown(cleanup));
    }

    method Stringify(value: Value) returns (completion: Value)
      modifies engine, engine.tagHelpers, writer
    {
      var written := SurfaceHost.CaptureWriterStringify(writer, value, engine, engine.tagHelpers);
      if SurfaceHost.CompletionIsThrown(written) {
        completion := written;
        return;
      }
      var text := SurfaceHost.CompletionValue(written);
      if !SurfaceHost.IsString(text) {
        completion := SurfaceHost.CaptureTypeError(
          "Dafny stringify returned a non-string value", engine, engine.tagHelpers, writer);
        return;
      }
      completion := written;
    }

    method ExceptionToString(receiver: Value) returns (completion: Value)
      modifies engine, engine.tagHelpers, writer
    {
      var nameRead := SurfaceHost.ReadProperty(receiver, "name", engine, engine.tagHelpers, writer);
      if SurfaceHost.CompletionIsThrown(nameRead) { completion := nameRead; return; }
      var nameText := SurfaceHost.TemplateString(
        SurfaceHost.CompletionValue(nameRead), engine, engine.tagHelpers, writer);
      if SurfaceHost.CompletionIsThrown(nameText) { completion := nameText; return; }

      var messageRead := SurfaceHost.ReadProperty(receiver, "message", engine, engine.tagHelpers, writer);
      if SurfaceHost.CompletionIsThrown(messageRead) { completion := messageRead; return; }
      var messageText := SurfaceHost.TemplateString(
        SurfaceHost.CompletionValue(messageRead), engine, engine.tagHelpers, writer);
      if SurfaceHost.CompletionIsThrown(messageText) { completion := messageText; return; }

      completion := SurfaceHost.ReturnedString(
        Native.Concat(
          Native.Concat(Native.StringValueOf(SurfaceHost.CompletionValue(nameText)), ": "),
          Native.StringValueOf(SurfaceHost.CompletionValue(messageText))));
    }

    method NotImplementedMessage(functionName: Value) returns (completion: Value)
      modifies engine, engine.tagHelpers, writer
    {
      var converted := SurfaceHost.TemplateString(functionName, engine, engine.tagHelpers, writer);
      if SurfaceHost.CompletionIsThrown(converted) { completion := converted; return; }
      var nameText := Native.StringValueOf(SurfaceHost.CompletionValue(converted));
      completion := SurfaceHost.ReturnedString(
        Native.Concat(
          Native.Concat("lightning-yaml ", nameText),
          "() is not implemented yet — this is the stub the benchmark + test harness is built against. See src/index.ts."));
    }
  }
}
