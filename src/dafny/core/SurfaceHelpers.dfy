module SurfaceHelpers {
  import opened Native

  method TagKindName(kind: Index) returns (name: string)
    requires kind <= 2
    ensures name == (if kind == 0 then "scalar" else if kind == 1 then "sequence" else "mapping")
  {
    if kind == 0 { name := "scalar"; }
    else if kind == 1 { name := "sequence"; }
    else { name := "mapping"; }
  }

  method ReturnSchemaIdentity(receiver: Value) returns (result: Value)
    ensures result == receiver
  {
    result := receiver;
  }

  method ReturnCapturedContents(captured: Value) returns (result: Value)
    ensures result == captured
  {
    result := captured;
  }
}
