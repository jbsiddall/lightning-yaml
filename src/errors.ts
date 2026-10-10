import { SurfaceErrors } from "./dafny/generated/engine.js";

export class NotImplementedError extends Error {
  constructor(fn: string) {
    super(
      `lightning-yaml ${fn}() is not implemented yet — this is the stub the ` +
        `benchmark + test harness is built against. See src/index.ts.`,
    );
    this.name = SurfaceErrors.__default.NotImplementedErrorName();
  }
}

export class YAMLParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = SurfaceErrors.__default.ParseErrorName();
  }
}
