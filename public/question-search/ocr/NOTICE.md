# Local OCR assets

tesseract.js 6.0.1 and tesseract.js-core 6.1.2 are distributed under Apache-2.0
(see LICENSE). Their exact npm sources are recorded in package-lock.json.
The `.wasm.js` files include their WebAssembly payloads.

English fast language data comes from naptha/tessdata, Apache-2.0:
https://github.com/naptha/tessdata/tree/806cd9adc8c6e8abc11c782db1818c990576bebc/4.0.0_fast

eng.traineddata.gz SHA-256:
18c1ac52b75e35d44735fb6c2a60acfaf23033524653200738e98f0243edb75b

Reproduce these files with `node scripts/prepare-question-search-ocr.mjs` after
`npm ci`. All OCR runtime requests stay on the site's own origin.
