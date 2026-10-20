/**
 * Maps caller-supplied UTF-16 source offsets to line and column positions.
 * Positions at or after a registered line start use one-based line and column
 * numbers. Before the first registered start, including when there are no
 * starts, `linePos()` returns `{ line: 0, col: offset }`. Callers must register
 * line starts in ascending order; duplicate starts are valid.
 */
export class LineCounter {
  /** Mutable source offsets at the start of each registered line. */
  lineStarts: number[] = [];

  /** Append a line start and return the number of starts recorded. */
  addNewLine = (offset: number): number => this.lineStarts.push(offset);

  /** Find the line and column for an offset in the registered line starts. */
  linePos = (offset: number): { line: number; col: number } => {
    let low = 0;
    let high = this.lineStarts.length;

    while (low < high) {
      const middle = low + Math.floor((high - low) / 2);
      if (this.lineStarts[middle]! < offset) low = middle + 1;
      else high = middle;
    }

    if (low < this.lineStarts.length && this.lineStarts[low] === offset) {
      return { line: low + 1, col: 1 };
    }
    if (low === 0) return { line: 0, col: offset };

    return { line: low, col: offset - this.lineStarts[low - 1]! + 1 };
  };
}
