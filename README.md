# makefun-site, faster

A drop-in for make.fun's makefun-site 1.0.0 (the "Build a static site faster" contest).
`solve.js` is a dependency-free ES module exporting `run(input)`; it returns the same output tree as the reference,
byte for byte. `main.ts` is the driver (`node main.ts`: reads `/input/cases.json`, answers each case alone with
`run()`, writes `/output/answers.json`; `MAKEFUN_INPUT_DIR` / `MAKEFUN_OUTPUT_DIR` override the directories).

The code was written from the reference's README and behaviour; the reference itself is used only as an oracle in the
tests.

## Approach

* **Markdown.** One pass over each body with `indexOf('\n')` and first-character dispatch instead of splitting and
  running several regexes per line. Inline rendering works on `(start, end)` ranges of the paragraph (no recursive
  `slice` copies), copies plain runs in one slice instead of escaping each character, and only scans for a closing
  marker when `indexOf` shows one exists. Blocks are collected in an array and joined once. U+2028 / U+2029 (which a
  regex `.` refuses) and JavaScript's own `\s` are handled exactly.
* **Front matter.** The closing `---` is found with `indexOf`; no whole-file split, no body re-join; the CRLF
  replacement only runs on files that contain `\r`.
* **Slugs** are memoised per case, with an ASCII fast path (non-ASCII text still goes through `normalize('NFKD')`
  and `\p{M}`).
* **Templates** are parsed with the reference's tokenizer rules, then compiled once per case into closures:
  paths are resolved statically (`site`, `tags`, `recent`, loop variables, `loop.*`); every part that depends only
  on `site`, `tags` and `recent` is evaluated at compile time into a constant string (loops over `tags` / `recent`
  are unrolled); loop variables live in module-level arrays, so no scope object or closure is allocated per
  iteration; an include whose output depends on one loop element alone (the card partial) is rendered once per
  element. A page is built by pushing parts on a shared buffer and joining it once.
* **Per-source work** (word count, card, link records) is done once per source.
* **Driver.** Node's `--no-opt` (no TurboFan: its concurrent compiler threads cost more CPU than they save on a run
  this short; Sparkplug and Maglev still run) and `--no-incremental-marking`, set with `v8.setFlagsFromString`
  before `solve.js` is imported (only when the V8 major version is 12 or newer, i.e. node 22+).

## Tests (`tests/`)

* `gen.mjs` draws extra cases with the kit's generator and answers them with the kit's oracle; `check.mjs` compares
  `run()` to those answers (and to the practice expectations) key by key.
* `fuzz-md.mjs` fuzzes inline Markdown, blocks, front matter, slugs, escaping and `\s` against the reference's modules;
  `fuzz-tpl.mjs` fuzzes the whole build with random template sets (nested and shadowing loops, `loop` as a name,
  broken tags, deep and recursive includes) against the reference.
* `bench.mjs` (whole-process CPU, entry vs. reference), `phases.mjs`, `ab.mjs`, `flags.mjs`, `flags2.mjs` and
  `main-exp.ts` are the timing tools. Generated data is written outside the repository.
