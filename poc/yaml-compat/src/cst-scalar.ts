/**
 * CST scalar utilities — resolve, create, and modify CST scalar tokens.
 */

import type { BlockScalar, FlowScalar, SourceToken, Token } from './cst.ts';
import {
  SCALAR_PLAIN, SCALAR_SINGLE, SCALAR_DOUBLE, SCALAR_FOLDED, SCALAR_LITERAL,
} from './nodes.ts';

type ScalarType = typeof SCALAR_PLAIN | typeof SCALAR_SINGLE | typeof SCALAR_DOUBLE |
  typeof SCALAR_FOLDED | typeof SCALAR_LITERAL | null;

export function resolveAsScalar(token: FlowScalar | BlockScalar, strict?: boolean, onError?: (offset: number, code: string, message: string) => void): {
  value: string;
  type: ScalarType;
  comment: string;
  range: [number, number, number];
};
export function resolveAsScalar(token: Token | null | undefined, strict?: boolean, onError?: (offset: number, code: string, message: string) => void): {
  value: string;
  type: ScalarType;
  comment: string;
  range: [number, number, number];
} | null;
export function resolveAsScalar(
  token: Token | null | undefined,
  strict = true,
  onError?: (offset: number, code: string, message: string) => void,
): { value: string; type: ScalarType; comment: string; range: [number, number, number] } | null {
  if (!token) return null;

  switch (token.type) {
    case 'scalar':
      return { value: token.source, type: SCALAR_PLAIN, comment: '', range: [token.offset, token.offset + token.source.length, token.offset + token.source.length] };
    case 'single-quoted-scalar':
      return { value: resolveSingleQuoted(token.source), type: SCALAR_SINGLE, comment: '', range: [token.offset, token.offset + token.source.length, token.offset + token.source.length] };
    case 'double-quoted-scalar':
      return { value: resolveDoubleQuoted(token.source), type: SCALAR_DOUBLE, comment: '', range: [token.offset, token.offset + token.source.length, token.offset + token.source.length] };
    case 'block-scalar': {
      const { value, type } = resolveBlockScalar(token.source, strict, onError);
      return { value, type, comment: '', range: [token.offset, token.offset + token.source.length, token.offset + token.source.length] };
    }
    case 'alias':
      return null;
    default:
      return null;
  }
}

function resolveSingleQuoted(src: string): string {
  // Strip quotes, replace '' with '
  return src.slice(1, -1).replace(/''/g, "'");
}

function resolveDoubleQuoted(src: string): string {
  // Strip quotes, process escapes
  const inner = src.slice(1, -1);
  let out = '';
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === '\\' && i + 1 < inner.length) {
      i++;
      switch (inner[i]) {
        case 'n': out += '\n'; break;
        case 't': out += '\t'; break;
        case 'r': out += '\r'; break;
        case '\\': out += '\\'; break;
        case '"': out += '"'; break;
        case '/': out += '/'; break;
        case '0': out += '\0'; break;
        case 'a': out += '\x07'; break;
        case 'b': out += '\b'; break;
        case 'e': out += '\x1b'; break;
        case 'f': out += '\f'; break;
        case ' ': out += ' '; break;
        case 'x': {
          const hex = inner.slice(i + 1, i + 3);
          out += String.fromCharCode(parseInt(hex, 16));
          i += 2;
          break;
        }
        case 'u': {
          const hex = inner.slice(i + 1, i + 5);
          out += String.fromCharCode(parseInt(hex, 16));
          i += 4;
          break;
        }
        case 'U': {
          const hex = inner.slice(i + 1, i + 9);
          out += String.fromCodePoint(parseInt(hex, 16));
          i += 8;
          break;
        }
        case '\n': break; // line continuation
        default: out += inner[i]!;
      }
    } else {
      out += inner[i]!;
    }
  }
  return out;
}

function resolveBlockScalar(src: string, _strict: boolean, _onError?: (offset: number, code: string, message: string) => void): { value: string; type: ScalarType } {
  // Basic block scalar resolution
  const header = src.match(/^([|>])([+-]?)(\d*)/);
  if (!header) return { value: src, type: SCALAR_LITERAL };

  const indicator = header[1];
  const chomp = header[2] || '';
  const indentStr = header[3];
  const explicitIndent = indentStr ? parseInt(indentStr, 10) : -1;

  const type = indicator === '|' ? SCALAR_LITERAL : SCALAR_FOLDED;

  // Find content after header line
  const nlIdx = src.indexOf('\n');
  if (nlIdx === -1) return { value: '', type };

  const body = src.slice(nlIdx + 1);
  if (!body) return { value: '', type };

  // Determine content indent from first non-empty line
  let contentIndent = Infinity;
  const lines = body.split('\n');
  for (const line of lines) {
    if (line.length > 0) {
      const match = line.match(/^(\s*)/);
      if (match) contentIndent = Math.min(contentIndent, match[1].length);
    }
  }
  if (contentIndent === Infinity) contentIndent = 0;

  // Use explicit indent if provided (it's relative to parent)
  if (explicitIndent > 0) {
    // For explicit indent, we don't auto-detect
    // contentIndent stays as detected
  }

  // Strip indent from each line
  const stripped = lines.map(line =>
    line.length > 0 ? line.slice(contentIndent) : ''
  );

  let value: string;
  if (indicator === '|') {
    // Literal: preserve newlines
    value = stripped.join('\n');
  } else {
    // Folded: replace single newlines with spaces, keep blank lines
    value = '';
    for (let i = 0; i < stripped.length; i++) {
      if (i > 0) {
        if (stripped[i] === '' || (i > 0 && stripped[i - 1] === '')) {
          value += '\n';
        } else {
          value += ' ';
        }
      }
      value += stripped[i];
    }
  }

  // Chomping
  if (chomp === '-') {
    // Strip: remove all trailing newlines
    value = value.replace(/\n+$/, '');
  } else if (chomp === '+') {
    // Keep: retain trailing newlines from source
    // Count trailing empty lines in original
    const trailingNl = body.match(/\n\s*$/);
    if (trailingNl) {
      const extraLines = lines.filter((l, i) => i >= stripped.length - 1 || l.trim() === '');
      // Keep trailing newlines
      value = value.replace(/\n*$/, '');
      let count = 0;
      for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i]!.trim() === '') count++;
        else break;
      }
      value += '\n'.repeat(count + 1);
    } else {
      if (!value.endsWith('\n')) value += '\n';
    }
  } else {
    // Clip: single trailing newline
    value = value.replace(/\n*$/, '') + '\n';
  }

  return { value, type };
}

export function createScalarToken(value: string, context: {
  end?: SourceToken[];
  implicitKey?: boolean;
  indent: number;
  inFlow?: boolean;
  offset?: number;
  type?: ScalarType;
}): BlockScalar | FlowScalar {
  const offset = context.offset ?? 0;
  const type = context.type ?? SCALAR_PLAIN;

  if (type === SCALAR_SINGLE) {
    const source = "'" + value.replace(/'/g, "''") + "'";
    return { type: 'single-quoted-scalar', offset, indent: context.indent, source, end: context.end };
  }
  if (type === SCALAR_DOUBLE) {
    const source = '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"';
    return { type: 'double-quoted-scalar', offset, indent: context.indent, source, end: context.end };
  }
  if (type === SCALAR_LITERAL || type === SCALAR_FOLDED) {
    const indicator = type === SCALAR_LITERAL ? '|' : '>';
    const lines = value.split('\n');
    const ind = ' '.repeat(context.indent + 2);
    const source = indicator + '\n' + lines.map(l => l ? ind + l : '').join('\n');
    return { type: 'block-scalar', offset, indent: context.indent, props: [], source };
  }
  // Plain scalar
  return { type: 'scalar', offset, indent: context.indent, source: value, end: context.end };
}

export function setScalarValue(token: Token, value: string, context?: {
  afterKey?: boolean;
  implicitKey?: boolean;
  inFlow?: boolean;
  type?: ScalarType;
}): void {
  // Determine type from existing token or context
  let type = context?.type;
  if (!type) {
    if (token.type === 'single-quoted-scalar') type = SCALAR_SINGLE;
    else if (token.type === 'double-quoted-scalar') type = SCALAR_DOUBLE;
    else if (token.type === 'block-scalar') type = SCALAR_LITERAL;
    else type = SCALAR_PLAIN;
  }

  const indent = 'indent' in token ? token.indent : 0;
  const newToken = createScalarToken(value, { indent, offset: token.offset, type });

  // Mutate the token in place
  (token as any).type = newToken.type;
  (token as any).source = newToken.source;
  if ('end' in newToken) (token as any).end = newToken.end;
  if ('props' in newToken) (token as any).props = newToken.props;
}
