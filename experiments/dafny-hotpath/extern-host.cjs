exports.quoteEnd = function quoteEnd(s, from) {
  const end = s.indexOf('"', from);
  if (end < 0) return s.length;
  const slash = s.indexOf('\\', from);
  if (slash >= 0 && slash < end) return s.length;
  const lf = s.indexOf('\n', from);
  if (lf >= 0 && lf < end) return s.length;
  return end;
};
