import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

import { CLIENT_HEADER_VALUE } from './version';

export const DEFAULT_BASE_URL = 'https://api.pdfik.net';
const DOCS_ERRORS = 'https://docs.pdfik.net/error-codes';

// A sync (`wait: true`) request may take up to the API's 45 s render budget plus upload;
// 90 s leaves room for the file to stream back without cutting a finished render.
export const REQUEST_TIMEOUT_MS = 90000;

export interface PdfikResponse {
	statusCode: number;
	headers: Record<string, string>;
	body: Buffer;
}

export interface MappedApiError {
	httpCode: number;
	title: string;
	detail: string;
	link: string;
	errorCode?: string;
	retryAfter?: string;
	/** The one-line message: `[status] title — detail (link)`. */
	message: string;
}

/** Thrown by the body builders for input the node can reject before any request. */
export class PdfikInputError extends Error {}

// ---------------------------------------------------------------------------
// Headers
// ---------------------------------------------------------------------------

/**
 * Headers this node adds to every request. The API key is NOT here: n8n adds
 * `X-API-Key` from the credential. There is deliberately no Idempotency-Key —
 * the API's key is account-wide and never expires, so any stable key reused by a
 * loop, a second n8n instance or a retried step could hand back someone's earlier
 * document.
 */
/**
 * The profile warning out of a 202 `detail`: pdf-api appends it to the queued sentence
 * ("Job successfully sent to processing queue. <warning>"). Undefined when nothing is left.
 */
export function profileWarning(detail: unknown): string | undefined {
	if (typeof detail !== 'string') return undefined;
	const rest = detail.replace(/^Job successfully sent to processing queue\.\s*/, '').trim();
	return rest || undefined;
}

export function buildClientHeaders(hasBody: boolean): Record<string, string> {
	const headers: Record<string, string> = { 'X-PDFik-Client': CLIENT_HEADER_VALUE };
	if (hasBody) headers['Content-Type'] = 'application/json';
	return headers;
}

export function normalizeBaseUrl(value: unknown): string {
	const raw = typeof value === 'string' && value.trim() !== '' ? value.trim() : DEFAULT_BASE_URL;
	return raw.replace(/\/+$/, '');
}

// ---------------------------------------------------------------------------
// Error mapping
// ---------------------------------------------------------------------------

const STATUS_TITLES: Record<number, string> = {
	400: 'Bad Request',
	401: 'Unauthorized',
	402: 'Payment Required',
	403: 'Forbidden',
	404: 'Not Found',
	405: 'Method Not Allowed',
	409: 'Conflict',
	410: 'Gone',
	413: 'Payload Too Large',
	422: 'Unprocessable Entity',
	429: 'Too Many Requests',
	500: 'Internal Server Error',
	502: 'Bad Gateway',
	503: 'Service Unavailable',
	504: 'Gateway Timeout',
};

// Anchors that exist on https://docs.pdfik.net/error-codes for a bare status.
const STATUS_ANCHORS = new Set([400, 401, 402, 403, 404, 405, 409, 410, 413, 429, 500, 503, 504]);

/** Removes anything that looks like a PDFik API key from a string. */
export function redactKeys(text: string): string {
	return text.replace(/sk_(live|test)_[A-Za-z0-9_-]+/g, 'sk_$1_***');
}

function statusLink(status: number): string {
	if (status === 422) return `${DOCS_ERRORS}#validation-error`;
	return STATUS_ANCHORS.has(status) ? `${DOCS_ERRORS}#${status}` : `${DOCS_ERRORS}#other-http-statuses`;
}

export function parseJsonBody(body: unknown): unknown {
	if (body === undefined || body === null) return undefined;
	if (Buffer.isBuffer(body) || body instanceof Uint8Array) {
		const text = Buffer.from(body).toString('utf8');
		return parseJsonText(text);
	}
	if (typeof body === 'string') return parseJsonText(body);
	return body;
}

function parseJsonText(text: string): unknown {
	const trimmed = text.trim();
	if (trimmed === '') return undefined;
	try {
		return JSON.parse(trimmed);
	} catch {
		return undefined;
	}
}

function validationDetail(list: unknown[]): string {
	const first = list[0] as IDataObject | undefined;
	if (!first || typeof first !== 'object') return 'The request did not pass validation';
	const msg = typeof first.msg === 'string' ? first.msg : 'Invalid value';
	const loc = Array.isArray(first.loc)
		? (first.loc as unknown[]).filter((part) => part !== 'body').map(String).join('.')
		: '';
	const more = list.length > 1 ? ` (and ${list.length - 1} more)` : '';
	return loc ? `${loc}: ${msg}${more}` : `${msg}${more}`;
}

/**
 * Turns any PDFik error response into one readable line. Understands the four body
 * shapes the API produces:
 *  1. RFC 7807 with `detail` as a string;
 *  2. 422 request validation: RFC 7807 whose `detail` is a list of `{loc, msg, type}`;
 *  3. 402 card wall: `detail` is an object carrying `message`;
 *  4. 413 from the request-size limit: `{error, limit_bytes, detail}`, not RFC 7807.
 * Anything else (an HTML page from a proxy, an empty body) falls back to the status.
 */
export function mapApiError(
	statusCode: number,
	body: unknown,
	headers: Record<string, string> = {},
): MappedApiError {
	const parsed = parseJsonBody(body);
	const obj = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as IDataObject) : undefined;
	const fallbackTitle = STATUS_TITLES[statusCode] ?? `HTTP ${statusCode}`;

	let detail = '';
	let errorCode: string | undefined;
	if (obj) {
		const raw = obj.detail;
		if (typeof raw === 'string') {
			detail = raw;
		} else if (Array.isArray(raw)) {
			detail = validationDetail(raw);
		} else if (raw && typeof raw === 'object') {
			const nested = raw as IDataObject;
			if (typeof nested.message === 'string') detail = nested.message;
			else if (typeof nested.detail === 'string') detail = nested.detail;
			if (typeof nested.error === 'string') errorCode = nested.error;
		}
		if (!errorCode && typeof obj.error === 'string') errorCode = obj.error;
	}
	if (!detail) detail = obj ? 'The API returned no further detail' : 'Unexpected response from the PDFik API';

	let title = obj && typeof obj.title === 'string' ? obj.title.trim() : '';
	// The generic handler copies a string detail into `title`, and a non-string detail
	// becomes "HTTP Error": neither says more than the status itself.
	if (!title || title === 'HTTP Error' || title === detail) title = fallbackTitle;

	const type = obj && typeof obj.type === 'string' ? obj.type : '';
	const link = type.startsWith(`${DOCS_ERRORS}#`) ? type : statusLink(statusCode);

	const retryAfter = headerValue(headers, 'retry-after');
	const safeDetail = redactKeys(detail);
	const safeTitle = redactKeys(title);
	return {
		httpCode: statusCode,
		title: safeTitle,
		detail: safeDetail,
		link,
		errorCode,
		retryAfter,
		message: `[${statusCode}] ${safeTitle} — ${safeDetail} (${link})`,
	};
}

export function headerValue(headers: Record<string, unknown> | undefined, name: string): string | undefined {
	if (!headers) return undefined;
	const wanted = name.toLowerCase();
	for (const key of Object.keys(headers)) {
		if (key.toLowerCase() === wanted) {
			const value = headers[key];
			if (Array.isArray(value)) return value.length ? String(value[0]) : undefined;
			return value === undefined || value === null ? undefined : String(value);
		}
	}
	return undefined;
}

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

export async function pdfikRequest(
	this: IExecuteFunctions,
	method: IHttpRequestMethods,
	path: string,
	itemIndex: number,
	body?: IDataObject,
): Promise<PdfikResponse> {
	const credentials = await this.getCredentials('pdfikApi', itemIndex);
	const options: IHttpRequestOptions = {
		method,
		url: `${normalizeBaseUrl(credentials.baseUrl)}${path}`,
		headers: buildClientHeaders(body !== undefined),
		encoding: 'arraybuffer',
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
		// A redirect would carry the X-API-Key header to wherever it points: never follow one
		// (a 3xx then fails as an error below).
		disableFollowRedirect: true,
		json: false,
		timeout: REQUEST_TIMEOUT_MS,
	};
	if (body !== undefined) options.body = body;

	let response: { statusCode?: number; headers?: Record<string, unknown>; body?: unknown };
	try {
		response = await this.helpers.httpRequestWithAuthentication.call(this, 'pdfikApi', options);
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		throw new NodeOperationError(this.getNode(), `Could not reach the PDFik API: ${redactKeys(reason)}`, {
			itemIndex,
		});
	}

	const statusCode = Number(response?.statusCode ?? 0);
	const headers: Record<string, string> = {};
	for (const [key, value] of Object.entries(response?.headers ?? {})) {
		if (value !== undefined && value !== null) headers[key.toLowerCase()] = Array.isArray(value) ? String(value[0]) : String(value);
	}
	const rawBody = response?.body;
	const buffer = Buffer.isBuffer(rawBody)
		? rawBody
		: rawBody instanceof ArrayBuffer || rawBody instanceof Uint8Array
			? Buffer.from(rawBody as Uint8Array)
			: typeof rawBody === 'string'
				? Buffer.from(rawBody, 'utf8')
				: rawBody === undefined || rawBody === null
					? Buffer.alloc(0)
					: Buffer.from(JSON.stringify(rawBody), 'utf8');

	if (statusCode < 200 || statusCode >= 300) {
		const mapped = mapApiError(statusCode, buffer, headers);
		const parsed = parseJsonBody(buffer);
		const errorBody: JsonObject =
			parsed && typeof parsed === 'object' && !Array.isArray(parsed)
				? (parsed as JsonObject)
				: { status: statusCode, detail: mapped.detail };
		const extra: string[] = [];
		if (mapped.errorCode) extra.push(`Error code: ${mapped.errorCode}.`);
		if (mapped.retryAfter) extra.push(`Retry after ${mapped.retryAfter} seconds.`);
		extra.push(`See ${mapped.link}`);
		const apiError = new NodeApiError(this.getNode(), errorBody, {
			message: mapped.message,
			description: extra.join(' '),
			httpCode: String(statusCode),
			itemIndex,
		});
		throw apiError;
	}

	return { statusCode, headers, body: buffer };
}

// ---------------------------------------------------------------------------
// Request body builders (pure; unit-tested)
// ---------------------------------------------------------------------------

function isSet(value: unknown): boolean {
	return value !== undefined && value !== null && value !== '';
}

/** PDF options from the node's "PDF Options" collection, in the API's shape. */
export function buildPdfOptions(input: IDataObject = {}): IDataObject | undefined {
	const out: IDataObject = {};
	if (isSet(input.format)) out.format = input.format;
	if (input.landscape !== undefined) out.landscape = input.landscape;
	if (input.printBackground !== undefined) out.print_background = input.printBackground;
	if (input.displayHeaderFooter !== undefined) out.display_header_footer = input.displayHeaderFooter;
	if (isSet(input.headerTemplate)) out.header_template = input.headerTemplate;
	if (isSet(input.footerTemplate)) out.footer_template = input.footerTemplate;
	if (isSet(input.scale)) out.scale = input.scale;
	// No PDF password (owner 2026-11-19): node parameters are kept in the workflow and its
	// execution data. The API and the SDKs keep the option.

	const margin: IDataObject = {};
	if (isSet(input.marginTop)) margin.top = input.marginTop;
	if (isSet(input.marginRight)) margin.right = input.marginRight;
	if (isSet(input.marginBottom)) margin.bottom = input.marginBottom;
	if (isSet(input.marginLeft)) margin.left = input.marginLeft;
	if (Object.keys(margin).length) out.margin = margin;

	const watermarkExtras = ['watermarkColor', 'watermarkFontSize', 'watermarkRotation'].filter((key) =>
		isSet(input[key]),
	);
	if (isSet(input.watermarkText)) {
		const watermark: IDataObject = { text: input.watermarkText };
		if (isSet(input.watermarkColor)) watermark.color = input.watermarkColor;
		if (isSet(input.watermarkFontSize)) watermark.font_size = input.watermarkFontSize;
		if (isSet(input.watermarkRotation)) watermark.rotation_degrees = input.watermarkRotation;
		out.watermark = watermark;
	} else if (watermarkExtras.length) {
		throw new PdfikInputError('Watermark Text is required when any other watermark option is set');
	}

	const compression: IDataObject = {};
	if (isSet(input.compressionLevel)) compression.level = input.compressionLevel;
	if (isSet(input.imageQuality)) compression.image_quality = input.imageQuality;
	if (Object.keys(compression).length) out.compression = compression;

	return Object.keys(out).length ? out : undefined;
}

/** Render options from the node's "Render Options" collection. */
export function buildRenderOptions(input: IDataObject = {}): IDataObject | undefined {
	const out: IDataObject = {};
	if (isSet(input.pageLoadTimeoutMs)) out.page_load_timeout_ms = input.pageLoadTimeoutMs;
	if (isSet(input.waitUntil)) out.wait_until = input.waitUntil;
	if (isSet(input.waitForSelector)) out.wait_for_selector = input.waitForSelector;
	if (isSet(input.waitAfterLoadMs)) out.wait_after_load_ms = input.waitAfterLoadMs;
	return Object.keys(out).length ? out : undefined;
}

export const DEFAULT_VIEWPORT_WIDTH = 1024;
export const DEFAULT_VIEWPORT_HEIGHT = 768;

/** Screenshot options from the node's "Image Options" collection. */
export function buildImageOptions(input: IDataObject = {}): IDataObject | undefined {
	const out: IDataObject = {};
	if (isSet(input.format)) out.format = input.format;
	if (input.fullPage !== undefined) out.full_page = input.fullPage;
	if (isSet(input.quality)) out.quality = input.quality;
	// The API wants both sides of the viewport or none; fill the missing one with its default.
	if (isSet(input.viewportWidth) || isSet(input.viewportHeight)) {
		out.viewport = {
			width: isSet(input.viewportWidth) ? input.viewportWidth : DEFAULT_VIEWPORT_WIDTH,
			height: isSet(input.viewportHeight) ? input.viewportHeight : DEFAULT_VIEWPORT_HEIGHT,
		};
	}
	return Object.keys(out).length ? out : undefined;
}

/** Adds the always-present sync flag, the optional test flag and the optional groups. */
export function finishCreateBody(
	body: IDataObject,
	parts: { test?: boolean; options?: IDataObject; render?: IDataObject },
): IDataObject {
	if (parts.options) body.options = parts.options;
	if (parts.render) body.render = parts.render;
	if (parts.test === true) body.test = true;
	body.wait = true;
	return body;
}

// ---------------------------------------------------------------------------
// File responses
// ---------------------------------------------------------------------------

const EXTENSIONS: Record<string, string> = {
	'application/pdf': 'pdf',
	'image/png': 'png',
	'image/jpeg': 'jpg',
};

export function fileFromResponse(
	response: PdfikResponse,
	fallbackJobId: string,
	defaultMimeType: string,
): { jobId: string; mimeType: string; fileName: string; warning?: string } {
	const jobId = headerValue(response.headers, 'x-pdfik-job-id') ?? fallbackJobId;
	const contentType = headerValue(response.headers, 'content-type');
	const mimeType = contentType ? contentType.split(';')[0].trim().toLowerCase() : defaultMimeType;
	const disposition = headerValue(response.headers, 'content-disposition') ?? '';
	const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
	const fromHeader = match ? match[1].trim().replace(/[\\/]/g, '_') : '';
	const extension = EXTENSIONS[mimeType] ?? EXTENSIONS[defaultMimeType] ?? 'bin';
	const fileName = fromHeader || `${jobId || 'pdfik'}.${extension}`;
	const warning = headerValue(response.headers, 'x-pdfik-warning');
	return warning ? { jobId, mimeType, fileName, warning } : { jobId, mimeType, fileName };
}

/** A sync create must answer with the file itself; JSON here means something else happened. */
export function assertFileResponse(response: PdfikResponse): string | undefined {
	const contentType = (headerValue(response.headers, 'content-type') ?? '').toLowerCase();
	if (response.statusCode !== 200 || contentType.startsWith('application/json')) {
		return `Expected the finished file from the PDFik API but got HTTP ${response.statusCode} (${contentType || 'no content type'})`;
	}
	return undefined;
}
