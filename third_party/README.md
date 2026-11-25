# Third-party components

## JSNES 3.0.0

- Project: https://github.com/bfirsh/jsnes
- Copyright 2020 Ben Firshman and contributors.
- License: Apache License 2.0; full text in `jsnes-LICENSE.txt`.
- The generated `js/core/nsfMachine.js` bundles the JSNES CPU, APU channels and serialization utilities from the npm package pinned in package-lock.json.
- SPECCA's NSF-specific memory mapper, headless host and routine scheduling are implemented in `src/nsf-machine.js` and `js/editor/nsfTrace.js`; this is not an unmodified full NES emulator. The PPU is stubbed because only NSF music routines are executed. UI tracing uses APU envelope/length/sweep state without rendering PCM.
- Rebuild using `npm ci && npm run build:nsf`. Upstream source files in node_modules are not modified.
