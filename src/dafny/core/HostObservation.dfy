// HOST-OPEN interface. No native correspondence proof is supplied here.
module HostObservation {
  import N = Native
  import M = SurfaceModel
  ghost predicate {:extern} RawDescription(raw: N.Value, described: M.Value) reads {}
  ghost predicate {:extern} RawSameValue(left: N.Value, right: N.Value) reads {}
}
