# Changelog

## [0.1.1] — 2026-11-19

- First release published from GitHub Actions with npm provenance (required for n8n
  node verification). No functional changes; requests now send `X-PDFik-Client: n8n/0.1.1`.

## [0.1.0] — 2026-11-19

First release.

- Credential **PDFik API**: API key and base URL; tested with `GET /account`.
- **Document**: Create From URL, Create From HTML, Create From Markdown.
- **Screenshot**: Capture URL, Capture HTML.
- **E-Invoice**: Create (XML from a binary field or text; Factur-X profile; optional template ID).
- **Job**: Get, Download.
- **Account**: Get.
- Results are returned in the same request (`wait: true`): the file in the binary field `data` and
  `{ jobId, bytes, test }` as JSON. No `Idempotency-Key` is sent.
- Every request identifies itself with `X-PDFik-Client: n8n/0.1.0`.
- Usable as an AI Agent tool (JSON output in that mode).
- API errors as one readable line with a link to the error code reference; `Continue On Fail` support.
