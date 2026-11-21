// solve.js — a faster drop-in for csv-reader 1.0.0 (make.fun's house entry).
//
// Same contract: run(input) returns {columns, rows, errors} for an input
// {text, header}, byte-for-byte the same values the reference program returns,
// but it reads the text with index scans and slices instead of building every
// field one character at a time.
//
// The broken-row policy is make.fun's own and is reproduced here exactly.

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

let T = '';
let N = 0;
let P = 0;
let LN = 1;
let ERRS = null;
let RL = 1;
let RR = null;

let fValue = '';
let fEnded = END;
let fAdded = 0;

function readUnquoted(startVal) {
  const text = T;
  const n = N;
  let i = P;
  let segStart = i;
  let parts = null;
  let added = 0;
  let v;
  while (i < n) {
    const c = text.charCodeAt(i);
    if (c === 44 /* , */) {
      if (parts === null) {
        v = startVal === '' ? text.slice(segStart, i) : startVal + text.slice(segStart, i);
      } else {
        parts.push(text.slice(segStart, i));
        v = startVal === '' ? parts.join('') : startVal + parts.join('');
      }
      P = i + 1; fValue = v; fEnded = COMMA; fAdded = added + (i - segStart); return;
    }
    if (c === 10 /* \n */) {
      if (parts === null) {
        v = startVal === '' ? text.slice(segStart, i) : startVal + text.slice(segStart, i);
      } else {
        parts.push(text.slice(segStart, i));
        v = startVal === '' ? parts.join('') : startVal + parts.join('');
      }
      P = i + 1; LN += 1; fValue = v; fEnded = LINE_BREAK; fAdded = added + (i - segStart); return;
    }
    if (c === 13 /* \r */) {
      if (text.charCodeAt(i + 1) === 10) {
        if (parts === null) {
          v = startVal === '' ? text.slice(segStart, i) : startVal + text.slice(segStart, i);
        } else {
          parts.push(text.slice(segStart, i));
          v = startVal === '' ? parts.join('') : startVal + parts.join('');
        }
        P = i + 2; LN += 1; fValue = v; fEnded = LINE_BREAK; fAdded = added + (i - segStart); return;
      }
      // A CR not followed by LF is dropped.
      ERRS.push({ code: 'stray_cr', line: RL, row: RR });
      if (parts === null) parts = [];
      parts.push(text.slice(segStart, i));
      added += i - segStart;
      i += 1; segStart = i;
      continue;
    }
    i += 1;
  }
  if (parts === null) {
    v = startVal === '' ? text.slice(segStart, i) : startVal + text.slice(segStart, i);
  } else {
    parts.push(text.slice(segStart, i));
    v = startVal === '' ? parts.join('') : startVal + parts.join('');
  }
  P = i; fValue = v; fEnded = END; fAdded = added + (i - segStart);
}

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  T = text; N = text.length;
  P = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  LN = 1;
  const errors = []; ERRS = errors;
  const rows = [];
  let columns = null;
  let width = -1;

  for (;;) {
    while (P < N) {
      const c = text.charCodeAt(P);
      if (c === 10) { P += 1; LN += 1; }
      else if (c === 13 && text.charCodeAt(P + 1) === 10) { P += 2; LN += 1; }
      else break;
    }
    if (P >= N) break;

    RL = LN;
    RR = (header && columns === null) ? null : rows.length;

    const fields = [];
    let quoted = false;
    for (;;) {
      quoted = text.charCodeAt(P) === 34;
      if (quoted) {
        const open = P;
        const openLine = LN;
        let segStart = P + 1;
        let parts = null;
        let closed = false;
        let value = '';
        let i = P + 1;
        while (i < N) {
          const c = text.charCodeAt(i);
          if (c === 34) {
            if (text.charCodeAt(i + 1) === 34) {
              if (parts === null) parts = [];
              parts.push(text.slice(segStart, i), '"');
              i += 2; segStart = i;
              continue;
            }
            if (parts === null) value = text.slice(segStart, i);
            else { parts.push(text.slice(segStart, i)); value = parts.join(''); }
            i += 1; closed = true;
            break;
          }
          if (c === 13) {
            if (parts === null) parts = [];
            parts.push(text.slice(segStart, i), '\n');
            LN += 1;
            i += text.charCodeAt(i + 1) === 10 ? 2 : 1;
            segStart = i;
            continue;
          }
          if (c === 10) { LN += 1; i += 1; continue; }
          i += 1;
        }
        if (!closed) {
          P = open + 1; LN = openLine;
          errors.push({ code: 'unterminated_quote', line: RL, row: RR });
          readUnquoted('"');
        } else {
          P = i;
          if (P >= N) { fValue = value; fEnded = END; fAdded = 0; }
          else {
            const c = text.charCodeAt(P);
            if (c === 44) { P += 1; fValue = value; fEnded = COMMA; fAdded = 0; }
            else if (c === 10) { P += 1; LN += 1; fValue = value; fEnded = LINE_BREAK; fAdded = 0; }
            else if (c === 13 && text.charCodeAt(P + 1) === 10) { P += 2; LN += 1; fValue = value; fEnded = LINE_BREAK; fAdded = 0; }
            else {
              readUnquoted(value);
              if (fAdded > 0) errors.push({ code: 'quote_junk', line: RL, row: RR });
            }
          }
        }
      } else {
        readUnquoted('');
      }
      fields.push(fValue);
      if (fEnded !== COMMA) break;
    }

    if (fields.length === 1 && fields[0] === '' && !quoted) continue;
    if (width < 0) width = fields.length;
    if (header && columns === null) { columns = fields; continue; }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: RL, row: RR, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: RL, row: RR, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  ERRS = null;
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
