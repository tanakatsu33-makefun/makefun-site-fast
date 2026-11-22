// A fast, dependency-free drop-in for makefun-site 1.0.0: run(input) returns the same output tree, byte for byte.
// Written from the rules (README) and checked against the reference as an oracle; see README.md for the approach.

const hasOwn = Object.prototype.hasOwnProperty;

// ------------------------------------------------------------------------------------------------ characters

/** JavaScript's own \s: what the reference's \S+ word count and its link-target whitespace test use. */
function isWs(c) {
  if (c < 160) return c === 32 || (c >= 9 && c <= 13);
  return c === 160 || c === 5760 || (c >= 8192 && c <= 8202) || c === 8232 || c === 8233 || c === 8239 || c === 8287 || c === 12288 || c === 65279;
}

/** 1 for the ASCII characters \s matches. */
const WS = new Uint8Array(128);
for (const c of [9, 10, 11, 12, 13, 32]) WS[c] = 1;

/** Whether s[a, e) holds U+2028 or U+2029, the two characters (besides line feeds) a regex dot refuses. */
function lsIn(s, a, e) {
  for (let i = a; i < e; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x2028 || c === 0x2029) return true;
  }
  return false;
}

/** The words of a text: its runs of characters other than whitespace. */
function wordCount(s) {
  let n = 0;
  let prev = 1; // 1 while the previous character was whitespace
  for (let i = 0, len = s.length; i < len; i++) {
    const c = s.charCodeAt(i);
    const ws = c < 128 ? WS[c] : isWs(c) ? 1 : 0;
    n += prev & (ws ^ 1);
    prev = ws;
  }
  return n;
}

// ------------------------------------------------------------------------------------------------ text rules

function ent(c) {
  return c === 38 ? '&amp;' : c === 60 ? '&lt;' : c === 62 ? '&gt;' : c === 34 ? '&quot;' : '&#39;';
}

/** s[a, e) with & < > " ' escaped (s itself when nothing changes and the range is all of it). */
function escRange(s, a, e) {
  let out = '';
  let last = a;
  for (let i = a; i < e; i++) {
    const c = s.charCodeAt(i);
    if (c > 62) continue;
    if (c === 38 || c === 60 || c === 62 || c === 34 || c === 39) {
      out += s.slice(last, i) + ent(c);
      last = i + 1;
    }
  }
  if (last === a) return a === 0 && e === s.length ? s : s.slice(a, e);
  return last < e ? out + s.slice(last, e) : out;
}

const esc = (s) => escRange(s, 0, s.length);

const SLUG_MAX = 64;
let slugCache = new Map();

/** The slug of a text (README, "Text"): NFKD, marks dropped, runs of other characters one "-", cut at 64. */
function slugify(text) {
  let hit = slugCache.get(text);
  if (hit !== undefined) return hit;
  let plain = text;
  for (let i = 0, n = text.length; i < n; i++) {
    if (text.charCodeAt(i) > 127) {
      plain = text.normalize('NFKD').replace(/\p{M}/gu, '');
      break;
    }
  }
  let out = '';
  let gap = false;
  for (let i = 0, n = plain.length; i < n; i++) {
    let c = plain.charCodeAt(i);
    if (c >= 65 && c <= 90) c += 32;
    else if (!((c >= 97 && c <= 122) || (c >= 48 && c <= 57))) {
      gap = out.length > 0;
      continue;
    }
    if (gap) out += '-';
    gap = false;
    out += String.fromCharCode(c);
  }
  if (out.length > SLUG_MAX) out = out.slice(0, SLUG_MAX);
  if (out.charCodeAt(out.length - 1) === 45) out = out.slice(0, -1);
  hit = out === '' ? 'untitled' : out;
  slugCache.set(text, hit);
  return hit;
}

/** `slug` made unique against `taken` (and added to it): the first of slug, slug-2, slug-3 ... not taken. */
function uniqueSlug(slug, taken) {
  let out = slug;
  for (let n = 2; taken.has(out); n++) out = `${slug}-${n}`;
  taken.add(out);
  return out;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** A YYYY-MM-DD date in words: "2026-11-09" is "9 November 2026" (the date is already validated). */
function longDate(d) {
  const day = (d.charCodeAt(8) - 48) * 10 + d.charCodeAt(9) - 48;
  const mon = (d.charCodeAt(5) - 48) * 10 + d.charCodeAt(6) - 48;
  return `${day} ${MONTHS[mon - 1]} ${d.slice(0, 4)}`;
}

// ------------------------------------------------------------------------------------------------ front matter

const KEY_OK = new Set(['title', 'date', 'tags', 'draft', 'layout', 'slug', 'summary']);
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const NAME_RE = /^[a-z0-9-]+$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function daysIn(y, m) {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

/** The reason the last parseFront refused its source. */
let fmError = '';
/** Where the body starts in the text after a successful parseFront. */
let fmBody = 0;

/** A quoted or bare string value; null (and fmError) when it is refused. */
function stringValue(key, raw) {
  if (raw.charCodeAt(0) === 34) {
    const n = raw.length;
    if (n < 2 || raw.charCodeAt(n - 1) !== 34) {
      fmError = `key "${key}": a quoted string is not closed`;
      return null;
    }
    if (raw.indexOf('\\', 1) === -1 && raw.indexOf('"', 1) === n - 1) return raw.slice(1, n - 1);
    let out = '';
    for (let i = 1; i < n - 1; i++) {
      const c = raw[i];
      if (c === '\\') {
        const nx = raw[i + 1];
        if ((nx !== '"' && nx !== '\\') || i + 1 === n - 1) {
          fmError = `key "${key}": a quoted string holds an escape other than \\" or \\\\`;
          return null;
        }
        out += nx;
        i++;
      } else if (c === '"') {
        fmError = `key "${key}": a quoted string holds a stray quote`;
        return null;
      } else out += c;
    }
    return out;
  }
  if (raw.charCodeAt(0) === 91) {
    fmError = `key "${key}": a bare string opens on [`;
    return null;
  }
  return raw;
}

/**
 * A source's front matter as a record { title, date, tags, draft, layout, slug, summary } (undefined where a key is not
 * given), or null with fmError set; fmBody is then where its body starts. `text` has "\n" line ends.
 */
function parseFront(text, hasLS) {
  const n = text.length;
  if (!(text.charCodeAt(0) === 45 && text.charCodeAt(1) === 45 && text.charCodeAt(2) === 45 && (n === 3 || text.charCodeAt(3) === 10))) {
    fmError = 'no front matter';
    return null;
  }
  let p = text.indexOf('\n---', 3);
  let q = 0;
  for (;;) {
    if (p === -1) {
      fmError = 'the front matter is not closed';
      return null;
    }
    q = p + 4;
    if (q === n || text.charCodeAt(q) === 10) break;
    p = text.indexOf('\n---', p + 1);
  }
  fmBody = q === n ? n : q + 1;
  const d = { title: undefined, date: undefined, tags: undefined, draft: undefined, layout: undefined, slug: undefined, summary: undefined };
  let ls = 4;
  let lineNo = 2;
  while (p > 3 && ls <= p) {
    let le = text.indexOf('\n', ls);
    if (le === -1 || le > p) le = p;
    const first = ls < le ? text.charCodeAt(ls) : 10;
    // a blank or comment line is skipped
    if (first !== 35) {
      let k = ls;
      while (k < le) {
        const c = text.charCodeAt(k);
        if (c !== 32 && c !== 9) break;
        k++;
      }
      if (k < le) {
        // key: [a-z_]+ then ":" then end of line or " " and the rest
        let ke = ls;
        while (ke < le) {
          const c = text.charCodeAt(ke);
          if ((c >= 97 && c <= 122) || c === 95) ke++;
          else break;
        }
        let ok = ke > ls && ke < le && text.charCodeAt(ke) === 58;
        let rs = le;
        if (ok) {
          if (ke + 1 === le) rs = le;
          else if (text.charCodeAt(ke + 1) === 32) {
            rs = ke + 2;
            if (hasLS && lsIn(text, rs, le)) ok = false;
          } else ok = false;
        }
        if (!ok) {
          fmError = `line ${lineNo} is not "key: value"`;
          return null;
        }
        const key = text.slice(ls, ke);
        let re = le;
        while (re > rs) {
          const c = text.charCodeAt(re - 1);
          if (c === 32 || c === 9) re--;
          else break;
        }
        if (!KEY_OK.has(key)) {
          fmError = `unknown key "${key}"`;
          return null;
        }
        if (d[key] !== undefined) {
          fmError = `key "${key}" is given twice`;
          return null;
        }
        if (re === rs) {
          fmError = `key "${key}" has no value`;
          return null;
        }
        const raw = text.slice(rs, re);
        let v;
        switch (key) {
          case 'title':
          case 'summary':
            v = stringValue(key, raw);
            if (v === null) return null;
            break;
          case 'date': {
            const m = DATE_RE.exec(raw);
            const y = m ? Number(m[1]) : 0;
            const mo = m ? Number(m[2]) : 0;
            const dd = m ? Number(m[3]) : 0;
            if (!m || y < 1970 || y > 2099 || mo < 1 || mo > 12 || dd < 1 || dd > daysIn(y, mo)) {
              fmError = 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)';
              return null;
            }
            v = raw;
            break;
          }
          case 'tags': {
            if (raw.charCodeAt(0) !== 91 || raw.charCodeAt(raw.length - 1) !== 93 || raw.length < 2) {
              fmError = 'key "tags": not a list [a, b]';
              return null;
            }
            const inner = raw.slice(1, -1);
            if (inner.trim() === '') v = [];
            else {
              v = inner.split(',');
              for (let t = 0; t < v.length; t++) {
                const name = v[t].trim();
                v[t] = name;
                if (name === '' || name.indexOf('"') !== -1 || name.indexOf('[') !== -1 || name.indexOf(']') !== -1) {
                  fmError = 'key "tags": an empty tag, or one holding " [ or ]';
                  return null;
                }
              }
            }
            break;
          }
          case 'draft':
            if (raw === 'true') v = true;
            else if (raw === 'false') v = false;
            else {
              fmError = 'key "draft": true or false';
              return null;
            }
            break;
          case 'layout':
            if (!NAME_RE.test(raw)) {
              fmError = 'key "layout": not a template name';
              return null;
            }
            v = raw;
            break;
          default:
            if (!(SLUG_RE.test(raw) && raw.length <= 64)) {
              fmError = 'key "slug": not a slug';
              return null;
            }
            v = raw;
        }
        d[key] = v;
      }
    }
    ls = le + 1;
    lineNo++;
  }
  if (d.title === undefined) {
    fmError = 'no title';
    return null;
  }
  return d;
}

// ------------------------------------------------------------------------------------------------ markdown: inline

/** Characters the inline renderer must look at: \ ` * [ & < > " ' */
const SPECIAL = new Uint8Array(128);
for (const ch of '\\`*[&<>"\'') SPECIAL[ch.charCodeAt(0)] = 1;
/** The characters a backslash escapes: \ ` * _ [ ] ( ) # + - . ! > */
const ESCAPABLE = new Uint8Array(128);
for (const ch of '\\`*_[]()#+-.!>') ESCAPABLE[ch.charCodeAt(0)] = 1;

const escapable = (c) => c < 128 && ESCAPABLE[c] === 1;

/** The current source's link resolver: target -> href. */
let linkOf = (target) => target;

/** First "**" from `from` outside an escape, that fits in [.., e): its index, or -1. */
function findStrong(s, from, e) {
  const first = s.indexOf('**', from);
  if (first === -1 || first + 2 > e) return -1;
  for (let j = from; j <= e - 2; j++) {
    const c = s.charCodeAt(j);
    if (c === 92 && j + 1 < e && escapable(s.charCodeAt(j + 1))) {
      j++;
      continue;
    }
    if (c === 42 && s.charCodeAt(j + 1) === 42) return j;
  }
  return -1;
}

/** First single "*" (not beside another one) from `from` outside an escape, before e, or -1. */
function findSingle(s, from, e) {
  const first = s.indexOf('*', from);
  if (first === -1 || first >= e) return -1;
  for (let j = from; j < e; j++) {
    const c = s.charCodeAt(j);
    if (c === 92 && j + 1 < e && escapable(s.charCodeAt(j + 1))) {
      j++;
      continue;
    }
    if (c !== 42) continue;
    if (j + 1 < e && s.charCodeAt(j + 1) === 42) {
      j++;
      continue;
    }
    return j;
  }
  return -1;
}

/** First "]" from `from` outside an escape, before e, or -1. */
function findBracket(s, from, e) {
  const first = s.indexOf(']', from);
  if (first === -1 || first >= e) return -1;
  for (let j = from; j < e; j++) {
    const c = s.charCodeAt(j);
    if (c === 92 && j + 1 < e && escapable(s.charCodeAt(j + 1))) {
      j++;
      continue;
    }
    if (c === 93) return j;
  }
  return -1;
}

/** s[a, e) rendered inline. */
function inl(s, a, e) {
  let out = '';
  let i = a;
  let run = a;
  while (i < e) {
    const c = s.charCodeAt(i);
    if (c >= 128 || SPECIAL[c] === 0) {
      i++;
      continue;
    }
    if (c === 38 || c === 60 || c === 62 || c === 34 || c === 39) {
      out += (i > run ? s.slice(run, i) : '') + ent(c);
      run = ++i;
      continue;
    }
    if (c === 92) {
      if (i + 1 < e && escapable(s.charCodeAt(i + 1))) {
        const nx = s.charCodeAt(i + 1);
        out += (i > run ? s.slice(run, i) : '') + (nx === 62 ? '&gt;' : s[i + 1]);
        i += 2;
        run = i;
      } else i++;
      continue;
    }
    if (c === 96) {
      const j = s.indexOf('`', i + 1);
      if (j > i + 1 && j < e) {
        out += (i > run ? s.slice(run, i) : '') + '<code>' + escRange(s, i + 1, j) + '</code>';
        i = j + 1;
        run = i;
      } else i++;
      continue;
    }
    if (c === 42) {
      if (i + 1 < e && s.charCodeAt(i + 1) === 42) {
        const j = findStrong(s, i + 2, e);
        if (j > i + 2) {
          out += (i > run ? s.slice(run, i) : '') + '<strong>' + inl(s, i + 2, j) + '</strong>';
          i = j + 2;
          run = i;
        } else i += 2;
        continue;
      }
      const j = findSingle(s, i + 1, e);
      if (j > i + 1) {
        out += (i > run ? s.slice(run, i) : '') + '<em>' + inl(s, i + 1, j) + '</em>';
        i = j + 1;
        run = i;
      } else i++;
      continue;
    }
    // c === 91: "["
    const k = findBracket(s, i + 1, e);
    if (k !== -1 && k + 1 < e && s.charCodeAt(k + 1) === 40) {
      let m = s.indexOf(')', k + 2);
      if (m >= e) m = -1;
      if (m > k + 2) {
        let ok = true;
        for (let t = k + 2; t < m; t++) {
          if (isWs(s.charCodeAt(t))) {
            ok = false;
            break;
          }
        }
        if (ok) {
          out += (i > run ? s.slice(run, i) : '') + '<a href="' + esc(linkOf(s.slice(k + 2, m))) + '">' + inl(s, i + 1, k) + '</a>';
          i = m + 1;
          run = i;
          continue;
        }
      }
    }
    i++;
  }
  if (out === '') return a === 0 && e === s.length ? s : s.slice(a, e);
  return run < e ? out + s.slice(run, e) : out;
}

// ------------------------------------------------------------------------------------------------ markdown: blocks

const isBlank = (s, a, e) => {
  for (; a < e; a++) {
    const c = s.charCodeAt(a);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
};

/** For a fence line ("```", a language of A-Za-z0-9_+-, then spaces or tabs): where its language ends, else -1. */
function fenceOpen(s, a, e) {
  if (e - a < 3 || s.charCodeAt(a) !== 96 || s.charCodeAt(a + 1) !== 96 || s.charCodeAt(a + 2) !== 96) return -1;
  let i = a + 3;
  while (i < e) {
    const c = s.charCodeAt(i);
    if ((c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57) || c === 95 || c === 43 || c === 45) i++;
    else break;
  }
  const langEnd = i;
  if (!isBlank(s, i, e)) return -1;
  return langEnd;
}

/** Whether the line is the end of a fence: "```" then spaces or tabs. */
const fenceClose = (s, a, e) => e - a >= 3 && s.charCodeAt(a) === 96 && s.charCodeAt(a + 1) === 96 && s.charCodeAt(a + 2) === 96 && isBlank(s, a + 3, e);

/** Whether the line is a thematic break: "---" or "***" then spaces or tabs. */
function isRule(s, a, e) {
  if (e - a < 3) return false;
  const c = s.charCodeAt(a);
  if ((c !== 45 && c !== 42) || s.charCodeAt(a + 1) !== c || s.charCodeAt(a + 2) !== c) return false;
  return isBlank(s, a + 3, e);
}

let hDepth = 0;
let hStart = 0;
let hEnd = 0;
/** Whether the line is a heading; then hDepth, and the text's range hStart..hEnd (never empty). */
function headingAt(s, a, e, hasLS) {
  let i = a;
  while (i < e && s.charCodeAt(i) === 35) i++;
  const depth = i - a;
  if (depth < 1 || depth > 6 || i >= e) return false;
  let c = s.charCodeAt(i);
  if (c !== 32 && c !== 9) return false;
  while (i < e) {
    c = s.charCodeAt(i);
    if (c !== 32 && c !== 9) break;
    i++;
  }
  let end = e;
  while (end > i) {
    c = s.charCodeAt(end - 1);
    if (c !== 32 && c !== 9) break;
    end--;
  }
  if (end === i) return false;
  if (hasLS && lsIn(s, i, e)) return false;
  hDepth = depth;
  hStart = i;
  hEnd = end;
  return true;
}

/** Whether the line ends a paragraph: blank, a fence, a heading or a thematic break. */
function endsParagraph(s, a, e, hasLS) {
  if (a >= e) return true;
  const c = s.charCodeAt(a);
  if (c === 32 || c === 9) return isBlank(s, a, e);
  if (c === 96) return fenceOpen(s, a, e) !== -1;
  if (c === 35) return headingAt(s, a, e, hasLS);
  if (c === 45 || c === 42) return isRule(s, a, e);
  return false;
}

/** s[a, e) without its leading and trailing spaces and tabs. */
function trimSlice(s, a, e) {
  while (a < e) {
    const c = s.charCodeAt(a);
    if (c === 32 || c === 9) a++;
    else break;
  }
  while (e > a) {
    const c = s.charCodeAt(e - 1);
    if (c === 32 || c === 9) e--;
    else break;
  }
  return s.slice(a, e);
}

/** For a bullet line ("- " or "* "): where its text starts, else -1. */
function bulletAt(s, a, e, hasLS) {
  if (e - a < 2) return -1;
  const c = s.charCodeAt(a);
  if ((c !== 45 && c !== 42) || s.charCodeAt(a + 1) !== 32) return -1;
  if (hasLS && lsIn(s, a + 2, e)) return -1;
  return a + 2;
}

let ordNumber = 0;
/** For an ordered line (1 to 9 digits, ". "): where its text starts (and ordNumber), else -1. */
function orderedAt(s, a, e, hasLS) {
  let i = a;
  let num = 0;
  while (i < e) {
    const c = s.charCodeAt(i);
    if (c < 48 || c > 57) break;
    num = num * 10 + c - 48;
    i++;
  }
  const digits = i - a;
  if (digits < 1 || digits > 9 || i + 1 >= e || s.charCodeAt(i) !== 46 || s.charCodeAt(i + 1) !== 32) return -1;
  if (hasLS && lsIn(s, i + 2, e)) return -1;
  ordNumber = num;
  return i + 2;
}

/** Whether the line continues a list item: two or more spaces and then a character that is not whitespace. */
function continuesItem(s, a, e) {
  let i = a;
  while (i < e && s.charCodeAt(i) === 32) i++;
  return i - a >= 2 && i < e && !isWs(s.charCodeAt(i));
}

/**
 * `src` (line ends "\n") rendered: { html, toc, excerpt } as the reference's renderMarkdown makes them. Links are
 * resolved by the current linkOf.
 */
function renderMarkdown(src, hasLS) {
  const len = src.length;
  const toc = [];
  let excerpt = null;
  const blocks = [];
  let ids = null;
  let pos = 0;
  while (pos <= len) {
    let le = src.indexOf('\n', pos);
    if (le === -1) le = len;
    const ls = pos;
    if (ls === le || isBlank(src, ls, le)) {
      pos = le + 1;
      continue;
    }
    const c0 = src.charCodeAt(ls);
    if (c0 === 96) {
      const langEnd = fenceOpen(src, ls, le);
      if (langEnd !== -1) {
        const lang = src.slice(ls + 3, langEnd);
        // the body: lines up to a closing fence or the end
        let bs = le + 1;
        let p = bs;
        let be = -1;
        let end = len + 1;
        let lines = 0;
        while (p <= len) {
          let e2 = src.indexOf('\n', p);
          if (e2 === -1) e2 = len;
          if (fenceClose(src, p, e2)) {
            end = e2 + 1;
            break;
          }
          be = e2;
          lines++;
          p = e2 + 1;
        }
        blocks.push('<pre><code' + (lang === '' ? '' : ' class="language-' + lang + '"') + '>' + (lines > 0 ? escRange(src, bs, be) + '\n' : '') + '</code></pre>\n');
        pos = end;
        continue;
      }
    }
    if (c0 === 35 && headingAt(src, ls, le, hasLS)) {
      const depth = hDepth;
      const text = src.slice(hStart, hEnd);
      if (ids === null) ids = new Set();
      const id = uniqueSlug(slugify(text), ids);
      const h = inl(text, 0, text.length);
      blocks.push('<h' + depth + ' id="' + id + '">' + h + '</h' + depth + '>\n');
      if (depth === 2 || depth === 3) toc.push({ level: depth, id, html: h });
      pos = le + 1;
      continue;
    }
    if ((c0 === 45 || c0 === 42) && isRule(src, ls, le)) {
      blocks.push('<hr>\n');
      pos = le + 1;
      continue;
    }
    if (c0 === 62) {
      let text = '';
      let any = false;
      let p = ls;
      while (p <= len) {
        let e2 = src.indexOf('\n', p);
        if (e2 === -1) e2 = len;
        if (p >= e2 || src.charCodeAt(p) !== 62) break;
        let a = p + 1;
        if (a < e2 && src.charCodeAt(a) === 32) a++;
        const piece = trimSlice(src, a, e2);
        if (piece !== '') {
          text = any ? text + '\n' + piece : piece;
          any = true;
        }
        p = e2 + 1;
      }
      blocks.push(any ? '<blockquote>\n<p>' + inl(text, 0, text.length) + '</p>\n</blockquote>\n' : '<blockquote>\n</blockquote>\n');
      pos = p;
      continue;
    }
    let ordered = false;
    let rest = bulletAt(src, ls, le, hasLS);
    let start = 1;
    if (rest === -1) {
      rest = orderedAt(src, ls, le, hasLS);
      if (rest !== -1) {
        ordered = true;
        start = ordNumber;
      }
    }
    if (rest !== -1) {
      let items = '';
      let cur = trimSlice(src, rest, le);
      let p = le + 1;
      while (p <= len) {
        let e2 = src.indexOf('\n', p);
        if (e2 === -1) e2 = len;
        const r = ordered ? orderedAt(src, p, e2, hasLS) : bulletAt(src, p, e2, hasLS);
        if (r !== -1) {
          items += '<li>' + inl(cur, 0, cur.length) + '</li>\n';
          cur = trimSlice(src, r, e2);
        } else if (continuesItem(src, p, e2)) cur += '\n' + trimSlice(src, p, e2);
        else break;
        p = e2 + 1;
      }
      items += '<li>' + inl(cur, 0, cur.length) + '</li>\n';
      const tag = ordered ? 'ol' : 'ul';
      blocks.push((ordered && start !== 1 ? '<ol start="' + start + '">' : '<' + tag + '>') + '\n' + items + '</' + tag + '>\n');
      pos = p;
      continue;
    }
    // a paragraph: this line and those after it up to a blank line, a fence, a heading or a thematic break
    let clean = true;
    let p = ls;
    let lastEnd = le;
    for (;;) {
      if (src.charCodeAt(p) === 32 || src.charCodeAt(p) === 9 || src.charCodeAt(lastEnd - 1) === 32 || src.charCodeAt(lastEnd - 1) === 9) clean = false;
      p = lastEnd + 1;
      if (p > len) break;
      let e2 = src.indexOf('\n', p);
      if (e2 === -1) e2 = len;
      if (endsParagraph(src, p, e2, hasLS)) break;
      lastEnd = e2;
    }
    let text;
    if (clean) text = src.slice(ls, lastEnd);
    else {
      text = '';
      let q = ls;
      for (;;) {
        let e2 = src.indexOf('\n', q);
        if (e2 === -1 || e2 > lastEnd) e2 = lastEnd;
        const piece = trimSlice(src, q, e2);
        text = q === ls ? piece : text + '\n' + piece;
        if (e2 >= lastEnd) break;
        q = e2 + 1;
      }
    }
    const h = inl(text, 0, text.length);
    if (excerpt === null) excerpt = h;
    blocks.push('<p>' + h + '</p>\n');
    pos = lastEnd + 1;
  }
  return { html: blocks.join(''), toc, excerpt: excerpt === null ? '' : excerpt };
}

// ------------------------------------------------------------------------------------------------ templates: parsing

const INCLUDE_DEPTH = 8;
const PATH_RE = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const FOR_RE = /^for ([A-Za-z_][A-Za-z0-9_]*) in (\S+)$/;
const IF_RE = /^if (not )?(\S+)$/;
const INCLUDE_RE = /^include "([a-z0-9-]+)"$/;

class TemplateError extends Error {}

function pathOf(name, text) {
  if (!PATH_RE.test(text)) throw new TemplateError(`template "${name}": ${JSON.stringify(text)} is not a path`);
  return text.split('.');
}

// node kinds
const N_TEXT = 0;
const N_VAR = 1;
const N_RAW = 2;
const N_IF = 3;
const N_FOR = 4;
const N_INCLUDE = 5;

/** `src`'s tokens: [kind, value] pairs; 0 text, 1 {{ }}, 2 {{{ }}}, 3 {% %} (a standalone tag takes its line). */
function tokenize(name, src) {
  const tokens = [];
  const len = src.length;
  let text = '';
  let i = 0;
  while (i < len) {
    const open = src.indexOf('{', i);
    if (open === -1 || open === len - 1) {
      text += src.slice(i);
      break;
    }
    const next = src.charCodeAt(open + 1);
    if (next !== 123 && next !== 37) {
      text += src.slice(i, open + 1);
      i = open + 1;
      continue;
    }
    text += src.slice(i, open);
    if (next === 123) {
      const raw = src.charCodeAt(open + 2) === 123;
      const from = open + (raw ? 3 : 2);
      const close = src.indexOf(raw ? '}}}' : '}}', from);
      if (close === -1) throw new TemplateError(`template "${name}": a ${raw ? '{{{' : '{{'} is not closed`);
      if (text !== '') tokens.push([0, text]);
      text = '';
      tokens.push([raw ? 2 : 1, pathOf(name, src.slice(from, close).trim())]);
      i = close + (raw ? 3 : 2);
      continue;
    }
    const close = src.indexOf('%}', open + 2);
    if (close === -1) throw new TemplateError(`template "${name}": a {% is not closed`);
    const end = close + 2;
    const lineStart = src.lastIndexOf('\n', open - 1) + 1;
    const nl = src.indexOf('\n', end);
    const lineEnd = nl === -1 ? len : nl;
    const standalone = isBlank(src, lineStart, open) && isBlank(src, end, lineEnd);
    if (standalone) text = text.slice(0, text.length - (open - lineStart));
    if (text !== '') tokens.push([0, text]);
    text = '';
    tokens.push([3, src.slice(open + 2, close).trim()]);
    i = standalone ? (nl === -1 ? len : nl + 1) : end;
  }
  if (text !== '') tokens.push([0, text]);
  return tokens;
}

/** `src` parsed into a node list (throws a TemplateError when it does not parse). */
function parseTemplate(name, src) {
  const root = { k: -1, body: [] };
  const stack = [root];
  let body = root.body;
  const tokens = tokenize(name, src);
  for (let t = 0; t < tokens.length; t++) {
    const kind = tokens[t][0];
    const val = tokens[t][1];
    if (kind === 0) body.push({ k: N_TEXT, s: val });
    else if (kind !== 3) body.push({ k: kind === 1 ? N_VAR : N_RAW, path: val });
    else {
      const top = stack[stack.length - 1];
      let m;
      if ((m = FOR_RE.exec(val)) !== null) {
        const node = { k: N_FOR, name: m[1], path: pathOf(name, m[2]), body: [] };
        body.push(node);
        stack.push(node);
        body = node.body;
      } else if ((m = IF_RE.exec(val)) !== null) {
        const node = { k: N_IF, not: m[1] !== undefined, path: pathOf(name, m[2]), then: [], else: null };
        body.push(node);
        stack.push(node);
        body = node.then;
      } else if (val === 'else') {
        if (top.k !== N_IF || top.else !== null) throw new TemplateError(`template "${name}": an else outside an if`);
        top.else = [];
        body = top.else;
      } else if (val === 'endfor' || val === 'endif') {
        if (top.k !== (val === 'endfor' ? N_FOR : N_IF)) throw new TemplateError(`template "${name}": an ${val} with no open ${val.slice(3)}`);
        stack.pop();
        const parent = stack[stack.length - 1];
        body = parent.k === -1 || parent.k === N_FOR ? parent.body : parent.else ?? parent.then;
      } else if ((m = INCLUDE_RE.exec(val)) !== null) body.push({ k: N_INCLUDE, name: m[1] });
      else throw new TemplateError(`template "${name}": {% ${val} %} is not a tag`);
    }
  }
  if (stack.length > 1) throw new TemplateError(`template "${name}": a ${stack[stack.length - 1].k === N_FOR ? 'for' : 'if'} is not closed`);
  return root.body;
}

// ------------------------------------------------------------------------------------------------ templates: compiling

// The page-dependent values a layout reads, set before a render; `site`, `tags` and `recent` are known when compiling.
let rPage = null;
let rPosts = null;
let rPager = null;
let rTag = null;
/** The loop variables of the dynamic (not unrolled) for loops being rendered: element, 0-based index, length. */
const fE = [];
const fK = [];
const fL = [];

let stSite = null;
let stTags = null;
let stRecent = null;
/** name -> parsed nodes, for the templates that parse. */
let templateNodes = new Map();
let compiled = new Map();

const K_PAGE = 0;
const K_INDEX = 1;
const K_TAG = 2;
const K_TAGS = 3;

/** The own property `k` of `v`, or undefined (the reference's lookup rule: objects and arrays only, own keys). */
function seg(v, k) {
  if (v === null || typeof v !== 'object') return undefined;
  return hasOwn.call(v, k) ? v[k] : undefined;
}

function textOf(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return v.map(textOf).join(', ');
  return '';
}

function truthy(v) {
  if (Array.isArray(v)) return v.length > 0;
  return v !== undefined && v !== null && v !== false && v !== '' && v !== 0;
}

/** What a compiled node reads that varies from page to page: the page's own values and the loops around it. */
function newDeps() {
  return { root: false, frames: new Set(), loops: new Set() };
}

/** A compile context: the template kind, the loops around the node (const = unrolled, else a slot), the include depth. */
function ctxWith(cx, frame, isDyn) {
  return { kind: cx.kind, frames: cx.frames.concat([frame]), depth: cx.depth, nd: isDyn ? cx.nd + 1 : cx.nd, deps: cx.deps };
}

/** A path's value, folded at compile time ({ c: true, v }) or as a getter ({ c: false, f, always }). */
function resolve(path, cx) {
  const first = path[0];
  const frames = cx.frames;
  for (let f = frames.length - 1; f >= 0; f--) {
    const fr = frames[f];
    if (first === 'loop') {
      if (fr.dyn) {
        const slot = fr.slot;
        cx.deps.loops.add(slot);
        if (path.length === 1) return { c: false, f: () => ({ index: fK[slot] + 1, first: fK[slot] === 0, last: fK[slot] === fL[slot] - 1, length: fL[slot] }), always: true };
        if (path.length > 2) return { c: true, v: undefined };
        switch (path[1]) {
          case 'index':
            return { c: false, f: () => fK[slot] + 1 };
          case 'first':
            return { c: false, f: () => fK[slot] === 0 };
          case 'last':
            return { c: false, f: () => fK[slot] === fL[slot] - 1 };
          case 'length':
            return { c: false, f: () => fL[slot] };
          default:
            return { c: true, v: undefined };
        }
      }
      let v = fr.loop;
      for (let k = 1; k < path.length; k++) v = seg(v, path[k]);
      return { c: true, v };
    }
    if (first === fr.name) {
      if (!fr.dyn) {
        let v = fr.value;
        for (let k = 1; k < path.length; k++) v = seg(v, path[k]);
        return { c: true, v };
      }
      const slot = fr.slot;
      cx.deps.frames.add(slot);
      return { c: false, f: getter(() => fE[slot], path, 1, slot, 0), always: false };
    }
  }
  let v;
  switch (first) {
    case 'site':
      v = stSite;
      break;
    case 'tags':
      v = stTags;
      break;
    case 'recent':
      v = stRecent;
      break;
    case 'page':
      if (cx.kind !== K_PAGE) return { c: true, v: undefined };
      cx.deps.root = true;
      return { c: false, f: getter(null, path, 1, -1, 1), always: path.length === 1 };
    case 'posts':
    case 'pager':
      if (cx.kind !== K_INDEX) return { c: true, v: undefined };
      cx.deps.root = true;
      return { c: false, f: getter(null, path, 1, -1, first === 'posts' ? 2 : 3), always: path.length === 1 && first === 'pager' };
    case 'tag':
      if (cx.kind !== K_TAG) return { c: true, v: undefined };
      cx.deps.root = true;
      return { c: false, f: getter(null, path, 1, -1, 4), always: path.length === 1 };
    default:
      return { c: true, v: undefined };
  }
  for (let k = 1; k < path.length; k++) v = seg(v, path[k]);
  return { c: true, v };
}

/** A getter for path[from..] below a base value (a frame's element, or one of the page roots). */
function getter(baseFn, path, from, slot, root) {
  const n = path.length - from;
  const base = baseFn !== null ? baseFn : root === 1 ? () => rPage : root === 2 ? () => rPosts : root === 3 ? () => rPager : () => rTag;
  if (n === 0) return base;
  const k0 = path[from];
  if (n === 1) return () => seg(base(), k0);
  const k1 = path[from + 1];
  if (n === 2) return () => seg(seg(base(), k0), k1);
  return () => {
    let v = base();
    for (let k = from; k < path.length; k++) v = seg(v, path[k]);
    return v;
  };
}

/**
 * The output being built: a compiled part is a constant string or a function that pushes its text here (a page's text is
 * the join of the buffer, so no page is a tree of concatenations).
 */
let W = [];

/** A part run: its text pushed on the buffer. */
const runPart = (p) => {
  if (typeof p === 'string') W.push(p);
  else p();
};

/** A sequence of parts as one part: adjacent constants merged. */
function sequence(parts) {
  const items = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (typeof p === 'string') {
      if (p === '') continue;
      const last = items.length - 1;
      if (last >= 0 && typeof items[last] === 'string') items[last] += p;
      else items.push(p);
    } else items.push(p);
  }
  const n = items.length;
  if (n === 0) return '';
  if (n === 1) return items[0];
  if (n === 3 && typeof items[0] === 'string' && typeof items[1] !== 'string' && typeof items[2] === 'string') {
    const a = items[0];
    const f = items[1];
    const b = items[2];
    return () => {
      W.push(a);
      f();
      W.push(b);
    };
  }
  return () => {
    for (let i = 0; i < n; i++) {
      const it = items[i];
      if (typeof it === 'string') W.push(it);
      else it();
    }
  };
}

function mergeDeps(into, from) {
  if (from.root) into.root = true;
  for (const s of from.frames) into.frames.add(s);
  for (const s of from.loops) into.loops.add(s);
}

function compileNodes(nodes, cx) {
  const parts = [];
  for (let i = 0; i < nodes.length; i++) parts.push(compileNode(nodes[i], cx));
  return parts.length === 1 ? parts[0] : sequence(parts);
}

function compileNode(n, cx) {
  switch (n.k) {
    case N_TEXT:
      return n.s;
    case N_VAR: {
      const r = resolve(n.path, cx);
      if (r.c) return esc(textOf(r.v));
      const f = r.f;
      return () => {
        const v = f();
        W.push(esc(typeof v === 'string' ? v : textOf(v)));
      };
    }
    case N_RAW: {
      const r = resolve(n.path, cx);
      if (r.c) return textOf(r.v);
      const f = r.f;
      return () => {
        const v = f();
        W.push(typeof v === 'string' ? v : textOf(v));
      };
    }
    case N_IF: {
      const r = resolve(n.path, cx);
      const branchOf = (yes) => {
        const b = yes !== n.not ? n.then : n.else;
        return b === null ? '' : compileNodes(b, cx);
      };
      if (r.c) return branchOf(truthy(r.v));
      if (r.always) return branchOf(true);
      const tp = n.not ? (n.else === null ? '' : compileNodes(n.else, cx)) : compileNodes(n.then, cx);
      const ep = n.not ? compileNodes(n.then, cx) : n.else === null ? '' : compileNodes(n.else, cx);
      const f = r.f;
      if (typeof tp === 'string' && typeof ep === 'string') return () => void W.push(truthy(f()) ? tp : ep);
      return () => {
        if (truthy(f())) runPart(tp);
        else runPart(ep);
      };
    }
    case N_FOR: {
      const r = resolve(n.path, cx);
      if (r.c) {
        const xs = r.v;
        if (!Array.isArray(xs)) return '';
        const parts = [];
        const len = xs.length;
        for (let k = 0; k < len; k++) {
          const frame = { name: n.name, dyn: false, value: xs[k], loop: { index: k + 1, first: k === 0, last: k === len - 1, length: len } };
          if (n.name === 'loop') frame.name = '';
          parts.push(compileNodes(n.body, ctxWith(cx, frame, false)));
        }
        return sequence(parts);
      }
      const slot = cx.nd;
      const frame = { name: n.name === 'loop' ? '' : n.name, dyn: true, slot };
      const body = compileNodes(n.body, ctxWith(cx, frame, true));
      const f = r.f;
      if (typeof body === 'string') {
        return () => {
          const xs = f();
          if (!Array.isArray(xs)) return;
          for (let k = 0; k < xs.length; k++) W.push(body);
        };
      }
      return () => {
        const xs = f();
        if (!Array.isArray(xs)) return;
        const len = xs.length;
        for (let k = 0; k < len; k++) {
          fE[slot] = xs[k];
          fK[slot] = k;
          fL[slot] = len;
          body();
        }
      };
    }
    default: {
      // include
      const nodes = templateNodes.get(n.name);
      if (nodes === undefined || cx.depth >= INCLUDE_DEPTH) return '';
      let key = null;
      let part;
      let deps;
      let anyConst = false;
      for (let f = 0; f < cx.frames.length; f++) if (!cx.frames[f].dyn) anyConst = true;
      if (!anyConst) key = n.name + '|' + cx.kind + '|' + cx.depth + '|' + cx.frames.map((fr) => fr.name).join('/');
      const hit = key === null ? undefined : compiled.get(key);
      if (hit !== undefined) {
        part = hit.part;
        deps = hit.deps;
      } else {
        deps = newDeps();
        part = compileNodes(nodes, { kind: cx.kind, frames: cx.frames, depth: cx.depth + 1, nd: cx.nd, deps });
        if (key !== null) compiled.set(key, { part, deps });
      }
      mergeDeps(cx.deps, deps);
      if (typeof part === 'string' || deps.root) return part;
      let free = -1;
      let count = 0;
      for (const s of deps.frames) {
        if (s < cx.nd) {
          free = s;
          count++;
        }
      }
      for (const s of deps.loops) if (s < cx.nd) count += 2;
      if (count !== 1) return part;
      // the output depends on one loop element alone: render it once per element
      const cache = new Map();
      const slot = free;
      const run = part;
      return () => {
        const e = fE[slot];
        let out = cache.get(e);
        if (out === undefined) {
          const start = W.length;
          run();
          out = W.slice(start).join('');
          W.length = start;
          cache.set(e, out);
        }
        W.push(out);
      };
    }
  }
}

/** Renders template `name` as `kind` (the page roots rPage... already set), or null when the template is missing. */
function renderTemplate(name, kind) {
  const key = '#' + name + '|' + kind;
  let part = compiled.get(key);
  if (part === undefined) {
    const nodes = templateNodes.get(name);
    part = nodes === undefined ? null : compileNodes(nodes, { kind, frames: [], depth: 0, nd: 0, deps: newDeps() });
    compiled.set(key, part);
  }
  if (part === null) return null;
  if (typeof part === 'string') return part;
  W.length = 0;
  part();
  return W.join('');
}

// ------------------------------------------------------------------------------------------------ the build

const byCodeUnits = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const SCHEME_RE = /^[A-Za-z][A-Za-z0-9+.-]*:/;

/** `rel` from the directory `dir`, "/"-separated, or null when it climbs out of the root. */
function resolvePath(dir, rel) {
  const parts = dir === '' ? [] : dir.split('/');
  const segs = rel.split('/');
  for (let i = 0; i < segs.length; i++) {
    const sg = segs[i];
    if (sg === '' || sg === '.') continue;
    if (sg === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(sg);
  }
  return parts.join('/');
}

const dirOf = (path) => {
  const k = path.lastIndexOf('/');
  return k === -1 ? '' : path.slice(0, k);
};

/** A page's link record as templates read it. */
function linkRecord(s) {
  if (s === null || s === undefined) return null;
  if (s.link === undefined) {
    const d = s.d.date;
    s.link = { title: s.d.title, url: s.url, date: d === undefined ? '' : d, date_long: d === undefined ? '' : longDate(d) };
  }
  return s.link;
}

/** A source's card, as lists show it (made once). */
function cardOf(s) {
  if (s.card === undefined) {
    const d = s.d.date;
    const tags = new Array(s.tagRefs.length);
    for (let i = 0; i < tags.length; i++) {
      const t = s.tagRefs[i];
      tags[i] = { name: t.name, slug: t.slug, url: t.url };
    }
    s.tagList = tags;
    s.card = {
      title: s.d.title,
      url: s.url,
      date: d === undefined ? '' : d,
      date_long: d === undefined ? '' : longDate(d),
      summary: s.d.summary === undefined ? '' : s.d.summary,
      excerpt: s.excerpt,
      reading_minutes: Math.max(1, Math.ceil(wordCount(s.body) / 200)),
      tags,
    };
  }
  return s.card;
}

/** A page as its layout reads it. */
function pageOf(s) {
  const c = cardOf(s);
  return {
    title: c.title,
    url: c.url,
    date: c.date,
    date_long: c.date_long,
    summary: c.summary,
    excerpt: c.excerpt,
    reading_minutes: c.reading_minutes,
    tags: c.tags,
    slug: s.slug,
    content: s.html,
    toc: s.toc,
    newer: linkRecord(s.newer),
    older: linkRecord(s.older),
    is_post: s.post,
  };
}

/** One site's output tree: path -> text. */
export function run(input) {
  slugCache = new Map();
  templateNodes = new Map();
  compiled = new Map();
  const site = input.site;
  const report = [];
  const broken = new Set();

  // templates, in code-unit order of their names; one that does not parse is reported and left out
  const tnames = Object.keys(input.templates).sort(byCodeUnits);
  for (let i = 0; i < tnames.length; i++) {
    try {
      templateNodes.set(tnames[i], parseTemplate(tnames[i], input.templates[tnames[i]]));
    } catch (err) {
      if (!(err instanceof TemplateError)) throw err;
      report.push(err.message);
    }
  }
  let base = site.base_url;
  let be = base.length;
  while (be > 0 && base.charCodeAt(be - 1) === 47) be--;
  base = base.slice(0, be);

  // sources and statics
  const files = input.files.slice().sort((x, y) => byCodeUnits(x.path, y.path));
  let sources = [];
  const statics = [];
  const staticPaths = new Set();
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (f.path.endsWith('.md')) {
      const c = f.content;
      sources.push({ path: f.path, text: c.indexOf('\r') === -1 ? c : c.replace(/\r\n?/g, '\n') });
    } else {
      statics.push(f);
      staticPaths.add(f.path);
    }
  }

  // front matter
  const kept = [];
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];
    const text = s.text;
    const hasLS = text.indexOf(' ') !== -1 || text.indexOf(' ') !== -1;
    const d = parseFront(text, hasLS);
    if (d === null) {
      report.push(`refused ${s.path}: ${fmError}`);
      continue;
    }
    s.d = d;
    s.body = text.slice(fmBody);
    s.hasLS = hasLS;
    const post = s.path.startsWith('posts/');
    s.post = post;
    const own = s.path.startsWith('tags/') ? 'tags' : s.path.startsWith('page/') ? 'page' : null;
    if (own !== null) {
      report.push(`refused ${s.path}: ${own}/ is the generator's own`);
      continue;
    }
    if (post && d.date === undefined) {
      report.push(`refused ${s.path}: a post needs a date`);
      continue;
    }
    const layout = d.layout !== undefined ? d.layout : post ? 'post' : 'page';
    if (!templateNodes.has(layout)) {
      report.push(`refused ${s.path}: layout "${layout}" is no template that parses`);
      continue;
    }
    s.layout = layout;
    if (d.draft === true) {
      report.push(`draft ${s.path}`);
      continue;
    }
    kept.push(s);
  }
  sources = kept;

  // permalinks
  const taken = new Map();
  const bySource = new Map();
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];
    const dir = s.post ? 'posts' : dirOf(s.path);
    let set = taken.get(dir);
    if (set === undefined) {
      set = new Set(dir === '' ? ['posts', 'tags', 'page'] : []);
      taken.set(dir, set);
    }
    const slug = uniqueSlug(s.d.slug !== undefined ? s.d.slug : slugify(s.d.title), set);
    s.slug = slug;
    s.outDir = dir === '' ? slug : dir + '/' + slug;
    s.url = base + '/' + s.outDir + '/';
    bySource.set(s.path, s);
  }

  // markdown, links resolved to the pages and static files they name
  let curDir = '';
  let curPath = '';
  linkOf = (target) => {
    const c0 = target.charCodeAt(0);
    if (c0 === 47 || c0 === 35 || SCHEME_RE.test(target)) return target;
    const hash = target.indexOf('#');
    const rel = hash === -1 ? target : target.slice(0, hash);
    const frag = hash === -1 ? '' : target.slice(hash);
    const path = rel === '' ? null : resolvePath(curDir, rel);
    if (path !== null) {
      const hit = bySource.get(path);
      if (hit !== undefined) return hit.url + frag;
      if (staticPaths.has(path)) return base + '/' + path + frag;
    }
    broken.add(`broken-link ${curPath} -> ${target}`);
    return target;
  };
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];
    curDir = dirOf(s.path);
    curPath = s.path;
    const md = renderMarkdown(s.body, s.hasLS);
    s.html = md.html;
    s.toc = md.toc;
    s.excerpt = md.excerpt;
  }

  // collections: the posts, newest first and then by slug
  const posts = [];
  for (let i = 0; i < sources.length; i++) if (sources[i].post) posts.push(sources[i]);
  posts.sort((x, y) => byCodeUnits(y.d.date, x.d.date) || byCodeUnits(x.slug, y.slug));
  for (let k = 0; k < posts.length; k++) {
    posts[k].newer = k === 0 ? null : posts[k - 1];
    posts[k].older = k === posts.length - 1 ? null : posts[k + 1];
  }

  // tags: grouped by slug, named as first met in the posts' order, ordered by count and then slug
  const bySlug = new Map();
  const slugsOf = (names) => {
    const slugs = [];
    const outNames = [];
    for (let i = 0; i < names.length; i++) {
      const sl = slugify(names[i]);
      if (slugs.indexOf(sl) === -1) {
        slugs.push(sl);
        outNames.push(names[i]);
      }
    }
    return { slugs, names: outNames };
  };
  for (let i = 0; i < posts.length; i++) {
    const p = posts[i];
    p.tagRefs = [];
    if (p.d.tags === undefined) continue;
    const own = slugsOf(p.d.tags);
    for (let k = 0; k < own.slugs.length; k++) {
      const sl = own.slugs[k];
      let tag = bySlug.get(sl);
      if (tag === undefined) {
        tag = { name: own.names[k], slug: sl, url: base + '/tags/' + sl + '/', posts: [] };
        bySlug.set(sl, tag);
      }
      tag.posts.push(p);
      p.tagRefs.push(tag);
    }
  }
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];
    if (s.post) continue;
    s.tagRefs = [];
    if (s.d.tags === undefined) continue;
    const own = slugsOf(s.d.tags);
    for (let k = 0; k < own.slugs.length; k++) {
      const tag = bySlug.get(own.slugs[k]);
      s.tagRefs.push(tag !== undefined ? tag : { name: own.names[k], slug: own.slugs[k], url: '', posts: [] });
    }
  }
  const tagList = Array.from(bySlug.values()).sort((x, y) => y.posts.length - x.posts.length || byCodeUnits(x.slug, y.slug));

  // layouts: every page through its layout, then the index pages, the tag pages and the tags page
  stSite = { title: site.title, base_url: base };
  stTags = new Array(tagList.length);
  for (let i = 0; i < tagList.length; i++) {
    const t = tagList[i];
    stTags[i] = { name: t.name, slug: t.slug, url: t.url, count: t.posts.length };
  }
  stRecent = posts.slice(0, site.recent).map(cardOf);
  const out = {};
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];
    rPage = pageOf(s);
    out[s.outDir + '/index.html'] = renderTemplate(s.layout, K_PAGE);
  }
  rPage = null;
  const per = site.per_page;
  const pages = Math.max(1, Math.ceil(posts.length / per));
  const indexUrl = (k) => (k === 1 ? base + '/' : base + '/page/' + k + '/');
  if (templateNodes.has('index')) {
    for (let k = 1; k <= pages; k++) {
      rPosts = posts.slice((k - 1) * per, k * per).map(cardOf);
      rPager = { number: k, total: pages, url: indexUrl(k), newer_url: k === 1 ? '' : indexUrl(k - 1), older_url: k === pages ? '' : indexUrl(k + 1) };
      out[k === 1 ? 'index.html' : 'page/' + k + '/index.html'] = renderTemplate('index', K_INDEX);
    }
  }
  if (templateNodes.has('tag')) {
    for (let i = 0; i < tagList.length; i++) {
      const t = tagList[i];
      rTag = { name: t.name, slug: t.slug, url: t.url, count: t.posts.length, posts: t.posts.map(cardOf) };
      out['tags/' + t.slug + '/index.html'] = renderTemplate('tag', K_TAG);
    }
  }
  const tagsHtml = renderTemplate('tags', K_TAGS);
  if (tagsHtml !== null) out['tags/index.html'] = tagsHtml;
  for (let i = 0; i < statics.length; i++) {
    const f = statics[i];
    if (hasOwn.call(out, f.path)) report.push(`shadowed ${f.path}: a built page has its path`);
    else out[f.path] = f.content;
  }

  // the report
  const lines = report.concat(Array.from(broken)).sort(byCodeUnits);
  let pageCount = 0;
  for (let i = 0; i < sources.length; i++) if (!sources[i].post) pageCount++;
  lines.push(`built ${pageCount} pages, ${posts.length} posts, ${tagList.length} tags and ${statics.length} static files`);
  out['build-report.txt'] = lines.join('\n') + '\n';
  return out;
}

export const __test = {
  inline: (s, link) => {
    linkOf = link;
    return inl(s, 0, s.length);
  },
  markdown: (s, link) => {
    linkOf = link;
    return renderMarkdown(s, s.indexOf(' ') !== -1 || s.indexOf(' ') !== -1);
  },
  slugify: (s) => slugify(s),
  front: (text) => {
    const d = parseFront(text, text.indexOf(' ') !== -1 || text.indexOf(' ') !== -1);
    return d === null ? { error: fmError } : { data: d, body: text.slice(fmBody) };
  },
  isWs,
  wordCount,
  esc,
};
