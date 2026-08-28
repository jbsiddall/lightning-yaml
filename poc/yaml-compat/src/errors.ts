/**
 * Error types for the yaml-compat POC parser.
 * Mirrors eemeli/yaml's YAMLError shape: message + pos/offsets for consumers.
 */

export class YAMLParseError extends Error {
  offset: [number, number];
  pos: { line: number; col: number }[];
  code?: string;

  constructor(offset: number | [number, number], message: string, lineCol?: { line: number; col: number }[], code?: string) {
    super(message);
    this.name = 'YAMLParseError';
    this.offset = typeof offset === 'number' ? [offset, offset] : offset;
    this.pos = lineCol ?? [];
    if (code) this.code = code;
  }
}

export class YAMLWarning extends Error {
  offset: [number, number];
  pos: { line: number; col: number }[];

  constructor(offset: number | [number, number], message: string, lineCol?: { line: number; col: number }[]) {
    super(message);
    this.name = 'YAMLWarning';
    this.offset = typeof offset === 'number' ? [offset, offset] : offset;
    this.pos = lineCol ?? [];
  }
}

export class YAMLNotImplemented extends Error {
  constructor(feature: string) {
    super(`Not implemented in POC: ${feature}`);
    this.name = 'YAMLNotImplemented';
  }
}

/** Compute line/col from an offset given the source string. 1-indexed. */
export function offsetToLineCol(src: string, offset: number): { line: number; col: number } {
  let line = 1;
  let lastNl = -1;
  for (let i = 0; i < offset && i < src.length; i++) {
    if (src.charCodeAt(i) === 10 /* \n */) {
      line++;
      lastNl = i;
    }
  }
  return { line, col: offset - lastNl };
}
