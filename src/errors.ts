export class NotImplementedError extends Error {
  constructor(fn: string) {
    super(
      `lightning-yaml ${fn}() is not implemented yet — this is the stub the ` +
        `benchmark + test harness is built against. See src/index.ts.`,
    );
    this.name = "NotImplementedError";
  }
}

export class YAMLParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "YAMLParseError";
  }
}
