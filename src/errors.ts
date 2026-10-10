import { SurfaceErrors } from "./dafny/generated/engine.js";
import { notImplementedMessageWithDafny } from "./dafny/bridge.ts";

export class NotImplementedError extends Error {
  constructor(fn: string) {
    super(notImplementedMessageWithDafny(fn));
    this.name = SurfaceErrors.__default.NotImplementedErrorName();
  }
}

export class YAMLParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = SurfaceErrors.__default.ParseErrorName();
  }
}
