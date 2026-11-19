# @pdfik/n8n-nodes-pdfik

The [PDFik](https://pdfik.net) node for [n8n](https://n8n.io). Turn a URL/HTML or Markdown into a PDF,
capture a screenshot of a page, build a Factur-X e-invoice from XML, and check jobs and your account
— from any n8n workflow.

- Full API documentation: https://docs.pdfik.net
- n8n guide: https://docs.pdfik.net/integrations/n8n

## Installation

This is an n8n community node package.

**Self-hosted n8n:** open **Settings → Community Nodes → Install**, enter `@pdfik/n8n-nodes-pdfik`
and confirm. See n8n's guide to
[installing community nodes](https://docs.n8n.io/integrations/community-nodes/installation/).

**n8n 3.x** only lists and runs verified community nodes by default. Until this package is verified,
start n8n with:

```bash
N8N_UNVERIFIED_PACKAGES_ENABLED=true
```

**n8n Cloud** shows verified community nodes only, so the node appears there once verification is
complete.

## Credentials

Create a **PDFik API** credential:

| Field | Value |
| :-- | :-- |
| API Key | A key from the PDFik dashboard → API Keys (`sk_live_…`) |
| Base URL | `https://api.pdfik.net` (keep the default) |

n8n checks the key with `GET /account`, which creates no job and costs nothing. The key is sent only
in the `X-API-Key` header and never appears in node output or error messages.

If the key has an IP whitelist, the requests come from the machine n8n runs on. For n8n Cloud, add
n8n Cloud's published outgoing IP addresses or use a key without a whitelist.

## Operations

Every create operation waits for the result in the same request (the API's `wait: true` mode) and
returns the file in the binary field `data`, plus this JSON:

```json
{ "jobId": "550e8400-e29b-41d4-a716-446655440000", "bytes": 48213, "test": false }
```

| Resource | Operation | API call | Output |
| :-- | :-- | :-- | :-- |
| Document | Create From URL | `POST /url-to-pdf` | PDF in `data` |
| Document | Create From HTML | `POST /html-to-pdf` | PDF in `data` |
| Document | Create From Markdown | `POST /markdown-to-pdf` | PDF in `data` |
| Screenshot | Capture URL | `POST /url-to-image` | PNG or JPEG in `data` |
| Screenshot | Capture HTML | `POST /html-to-image` | PNG or JPEG in `data` |
| E-Invoice | Create | `POST /einvoice-to-pdf` | PDF/A-3 with embedded Factur-X XML in `data` |
| Job | Get | `GET /jobs/{id}` | Job status and metrics as JSON |
| Job | Download | `GET /jobs/{id}/download` | The job's file in `data` |
| Account | Get | `GET /account` | Plan, current quota window, usage and limits as JSON |

### Options

- **PDF Options** (Document operations): format (A0–A6, Letter, Legal, Tabloid, Ledger), landscape,
  margins, print background, header and footer templates, watermark (text, color, font size,
  rotation), compression level, image quality, scale.
- **Render Options** (Document and Screenshot operations): page load timeout, wait until
  (`load`, `domcontentloaded`, `networkidle`, `commit`), wait for selector, wait after load.
- **Image Options** (Screenshot operations): format (PNG or JPEG), full page, JPEG quality,
  viewport width and height. You choose the size; the page is captured exactly as requested.
- **Test Mode** (every create operation): the job runs through the whole pipeline but nothing is
  rendered, a sample file is returned and no quota is used.
- **E-Invoice**: the XML comes from a binary field of the input item (default `data`) or from text;
  pick the Factur-X profile the XML declares and, optionally, a saved template ID. The MINIMUM and
  BASIC WL profiles are accompanying data only; their note comes back in the `warning` field.

Webhooks, delivery to your own storage and page authentication are not part of this node.

### AI Agent tool

The node can be used as a tool by n8n's AI Agent. In that mode the create operations queue the
job and return JSON only (`jobId`, `status`, `test`); the agent can follow it with **Job → Get**.
**Job → Download** returns a file, which a tool cannot pass on: it refuses in tool mode — download
the job in a regular workflow step (each file can be downloaded 3 times, for 24 hours).

### Errors

API errors are shown as one line, for example:

```
[422] Unprocessable Entity - Request Validation Error — options.scale: Value error, options.scale must be between 0.5 and 2.0 (https://docs.pdfik.net/error-codes#validation-error)
```

The link points to the explanation in the [error code reference](https://docs.pdfik.net/error-codes).
With **On Error → Continue**, a failed item becomes `{ "error": "…", "description": "…", "httpCode": "…" }`
and the remaining items are processed.

If a render takes longer than the synchronous budget (45 seconds), the API cancels the job, charges
nothing and answers `503` (`#sync-timeout`); running the node again is safe. A render that fails
answers `422` (`#job-failed`) with the job's error code.

The node never sends an `Idempotency-Key`: every execution creates a new job.

## Limits

- Generated files: up to 150 MB per file.
- HTML input: up to 512 KiB. Markdown input: up to 100,000 characters. URL: up to 8,192 characters.
- E-invoice XML: up to 1 MB. Request body: up to 5 MB.
- Screenshot viewport: width 320–1920 px, height 320–8192 px; full-page captures are capped at
  8,192 px high.
- A finished file can be downloaded a limited number of times (3 attempts, including the response of
  a create operation).
- Monthly quota, requests per minute and concurrent jobs depend on your plan: see
  [rate limits](https://docs.pdfik.net/rate-limits) and **Account → Get**.

## Example workflows

Import a workflow with **Workflows → Import from File/URL** (or paste the JSON into the editor),
then select your own PDFik credential in each PDFik node.

### URL to PDF

```json
{
  "name": "PDFik: URL to PDF",
  "nodes": [
    {
      "id": "6f1d5f0e-6c39-4c8e-9d57-0a4a1c1b0001",
      "name": "When clicking 'Execute workflow'",
      "type": "n8n-nodes-base.manualTrigger",
      "typeVersion": 1,
      "position": [0, 0],
      "parameters": {}
    },
    {
      "id": "6f1d5f0e-6c39-4c8e-9d57-0a4a1c1b0002",
      "name": "PDFik",
      "type": "@pdfik/n8n-nodes-pdfik.pdfik",
      "typeVersion": 1,
      "position": [220, 0],
      "parameters": {
        "resource": "document",
        "operation": "createFromUrl",
        "url": "https://example.com",
        "pdfOptions": {
          "format": "A4",
          "marginTop": "10mm",
          "marginBottom": "10mm"
        }
      },
      "credentials": {
        "pdfikApi": { "id": "REPLACE_WITH_CREDENTIAL_ID", "name": "PDFik account" }
      }
    }
  ],
  "connections": {
    "When clicking 'Execute workflow'": {
      "main": [[{ "node": "PDFik", "type": "main", "index": 0 }]]
    }
  },
  "settings": {}
}
```

### HTML to PDF with header, footer and watermark (test mode)

```json
{
  "name": "PDFik: HTML to PDF",
  "nodes": [
    {
      "id": "6f1d5f0e-6c39-4c8e-9d57-0a4a1c1b0011",
      "name": "When clicking 'Execute workflow'",
      "type": "n8n-nodes-base.manualTrigger",
      "typeVersion": 1,
      "position": [0, 0],
      "parameters": {}
    },
    {
      "id": "6f1d5f0e-6c39-4c8e-9d57-0a4a1c1b0012",
      "name": "PDFik",
      "type": "@pdfik/n8n-nodes-pdfik.pdfik",
      "typeVersion": 1,
      "position": [220, 0],
      "parameters": {
        "resource": "document",
        "operation": "createFromHtml",
        "html": "<h1>Invoice 2026-001</h1><p>Thank you for your order.</p>",
        "test": true,
        "pdfOptions": {
          "format": "Letter",
          "displayHeaderFooter": true,
          "headerTemplate": "<span style='font-size:10px'>ACME Ltd</span>",
          "footerTemplate": "<span style='font-size:10px'>Page <span class='pageNumber'></span> of <span class='totalPages'></span></span>",
          "marginTop": "20mm",
          "marginBottom": "20mm",
          "watermarkText": "DRAFT"
        },
        "renderOptions": {
          "waitUntil": "load"
        }
      },
      "credentials": {
        "pdfikApi": { "id": "REPLACE_WITH_CREDENTIAL_ID", "name": "PDFik account" }
      }
    }
  ],
  "connections": {
    "When clicking 'Execute workflow'": {
      "main": [[{ "node": "PDFik", "type": "main", "index": 0 }]]
    }
  },
  "settings": {}
}
```

### Markdown to PDF (test mode)

```json
{
  "name": "PDFik: Markdown to PDF",
  "nodes": [
    {
      "id": "6f1d5f0e-6c39-4c8e-9d57-0a4a1c1b0021",
      "name": "When clicking 'Execute workflow'",
      "type": "n8n-nodes-base.manualTrigger",
      "typeVersion": 1,
      "position": [0, 0],
      "parameters": {}
    },
    {
      "id": "6f1d5f0e-6c39-4c8e-9d57-0a4a1c1b0022",
      "name": "PDFik",
      "type": "@pdfik/n8n-nodes-pdfik.pdfik",
      "typeVersion": 1,
      "position": [220, 0],
      "parameters": {
        "resource": "document",
        "operation": "createFromMarkdown",
        "markdown": "# Weekly report\n\n| Item | Status |\n| --- | --- |\n| Release | Done |",
        "test": true
      },
      "credentials": {
        "pdfikApi": { "id": "REPLACE_WITH_CREDENTIAL_ID", "name": "PDFik account" }
      }
    }
  ],
  "connections": {
    "When clicking 'Execute workflow'": {
      "main": [[{ "node": "PDFik", "type": "main", "index": 0 }]]
    }
  },
  "settings": {}
}
```

### Screenshot of a URL

```json
{
  "name": "PDFik: Screenshot of a URL",
  "nodes": [
    {
      "id": "6f1d5f0e-6c39-4c8e-9d57-0a4a1c1b0031",
      "name": "When clicking 'Execute workflow'",
      "type": "n8n-nodes-base.manualTrigger",
      "typeVersion": 1,
      "position": [0, 0],
      "parameters": {}
    },
    {
      "id": "6f1d5f0e-6c39-4c8e-9d57-0a4a1c1b0032",
      "name": "PDFik",
      "type": "@pdfik/n8n-nodes-pdfik.pdfik",
      "typeVersion": 1,
      "position": [220, 0],
      "parameters": {
        "resource": "screenshot",
        "operation": "captureUrl",
        "url": "https://example.com",
        "imageOptions": {
          "format": "jpeg",
          "quality": 80,
          "viewportWidth": 1280,
          "viewportHeight": 800
        }
      },
      "credentials": {
        "pdfikApi": { "id": "REPLACE_WITH_CREDENTIAL_ID", "name": "PDFik account" }
      }
    }
  ],
  "connections": {
    "When clicking 'Execute workflow'": {
      "main": [[{ "node": "PDFik", "type": "main", "index": 0 }]]
    }
  },
  "settings": {}
}
```

### E-invoice from an XML file (test mode)

Reads `invoice.xml` from n8n's file folder (`/home/node/.n8n-files` in the official Docker image) and
turns it into a Factur-X PDF. A sample XML is available at
https://pdfik.net/e-invoicing/sample-invoice.xml.

```json
{
  "name": "PDFik: E-invoice from XML",
  "nodes": [
    {
      "id": "6f1d5f0e-6c39-4c8e-9d57-0a4a1c1b0041",
      "name": "When clicking 'Execute workflow'",
      "type": "n8n-nodes-base.manualTrigger",
      "typeVersion": 1,
      "position": [0, 0],
      "parameters": {}
    },
    {
      "id": "6f1d5f0e-6c39-4c8e-9d57-0a4a1c1b0042",
      "name": "Read invoice XML",
      "type": "n8n-nodes-base.readWriteFile",
      "typeVersion": 1,
      "position": [220, 0],
      "parameters": {
        "fileSelector": "/home/node/.n8n-files/invoice.xml",
        "options": {}
      }
    },
    {
      "id": "6f1d5f0e-6c39-4c8e-9d57-0a4a1c1b0043",
      "name": "PDFik",
      "type": "@pdfik/n8n-nodes-pdfik.pdfik",
      "typeVersion": 1,
      "position": [440, 0],
      "parameters": {
        "resource": "eInvoice",
        "operation": "create",
        "xmlSource": "binary",
        "binaryPropertyName": "data",
        "profile": "en16931",
        "test": true
      },
      "credentials": {
        "pdfikApi": { "id": "REPLACE_WITH_CREDENTIAL_ID", "name": "PDFik account" }
      }
    }
  ],
  "connections": {
    "When clicking 'Execute workflow'": {
      "main": [[{ "node": "Read invoice XML", "type": "main", "index": 0 }]]
    },
    "Read invoice XML": {
      "main": [[{ "node": "PDFik", "type": "main", "index": 0 }]]
    }
  },
  "settings": {}
}
```

### Account information

```json
{
  "name": "PDFik: Account information",
  "nodes": [
    {
      "id": "6f1d5f0e-6c39-4c8e-9d57-0a4a1c1b0051",
      "name": "When clicking 'Execute workflow'",
      "type": "n8n-nodes-base.manualTrigger",
      "typeVersion": 1,
      "position": [0, 0],
      "parameters": {}
    },
    {
      "id": "6f1d5f0e-6c39-4c8e-9d57-0a4a1c1b0052",
      "name": "PDFik",
      "type": "@pdfik/n8n-nodes-pdfik.pdfik",
      "typeVersion": 1,
      "position": [220, 0],
      "parameters": {
        "resource": "account",
        "operation": "get"
      },
      "credentials": {
        "pdfikApi": { "id": "REPLACE_WITH_CREDENTIAL_ID", "name": "PDFik account" }
      }
    }
  ],
  "connections": {
    "When clicking 'Execute workflow'": {
      "main": [[{ "node": "PDFik", "type": "main", "index": 0 }]]
    }
  },
  "settings": {}
}
```

## Compatibility

Built for n8n 2.x and 3.x. Requires Node.js 22 or newer when building from source.

## Development

```bash
npm ci
npm run build
npm run lint
npm test
```

## Links

- PDFik documentation: https://docs.pdfik.net
- Error codes: https://docs.pdfik.net/error-codes
- Support: support@pdfik.net

## License

[MIT](LICENSE)
