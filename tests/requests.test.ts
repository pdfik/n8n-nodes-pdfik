import pkg from '../package.json';

import { PdfikApi } from '../credentials/PdfikApi.credentials';
import { buildClientHeaders } from '../nodes/Pdfik/GenericFunctions';
import { Pdfik } from '../nodes/Pdfik/Pdfik.node';
import { CLIENT_HEADER_VALUE, PACKAGE_VERSION } from '../nodes/Pdfik/version';
import { createContext, jsonResponse, pdfResponse, PLACEHOLDER_KEY, requestOf } from './helpers';

const node = new Pdfik();

describe('headers', () => {
	it('keeps the client version in step with package.json', () => {
		expect(PACKAGE_VERSION).toBe(pkg.version);
		expect(CLIENT_HEADER_VALUE).toBe(`n8n/${pkg.version}`);
	});

	it('adds the client header and never an Idempotency-Key', () => {
		const withBody = buildClientHeaders(true);
		expect(withBody).toEqual({ 'X-PDFik-Client': CLIENT_HEADER_VALUE, 'Content-Type': 'application/json' });
		expect(Object.keys(buildClientHeaders(false))).toEqual(['X-PDFik-Client']);
		for (const headers of [withBody, buildClientHeaders(false)]) {
			expect(Object.keys(headers).map((h) => h.toLowerCase())).not.toContain('idempotency-key');
		}
	});

	it('sends the key as X-API-Key through the credential and tests it with GET /account', () => {
		const credential = new PdfikApi();
		expect(credential.authenticate).toEqual({
			type: 'generic',
			properties: { headers: { 'X-API-Key': '={{$credentials.apiKey}}' } },
		});
		expect(credential.test.request.url).toBe('/account');
		expect(credential.test.request.method).toBe('GET');
		expect(credential.test.request.headers).toEqual({ 'X-PDFik-Client': CLIENT_HEADER_VALUE });
		const apiKey = credential.properties.find((p) => p.name === 'apiKey');
		expect(apiKey?.typeOptions?.password).toBe(true);
		expect(credential.properties.find((p) => p.name === 'baseUrl')?.default).toBe('https://api.pdfik.net');
	});

	it('every request goes through the credential with the client header and no Idempotency-Key', async () => {
		const { context, httpRequestWithAuthentication } = createContext({
			params: { resource: 'document', operation: 'createFromUrl', url: 'https://example.com', test: false },
			responses: [pdfResponse()],
		});
		await node.execute.call(context);
		expect(httpRequestWithAuthentication).toHaveBeenCalledTimes(1);
		expect(httpRequestWithAuthentication.mock.calls[0][0]).toBe('pdfikApi');
		const request = requestOf(httpRequestWithAuthentication);
		const headers = request.headers as Record<string, string>;
		expect(headers['X-PDFik-Client']).toBe(CLIENT_HEADER_VALUE);
		expect(Object.keys(headers).map((h) => h.toLowerCase())).not.toContain('idempotency-key');
		// The node never handles the key itself: n8n injects it from the credential.
		expect(JSON.stringify(request)).not.toContain(PLACEHOLDER_KEY);
		expect(request.url).toBe('https://api.pdfik.net/url-to-pdf');
	});
});

describe('no PDF password', () => {
	// Node parameters are kept in the workflow and its execution data (owner 2026-11-19).
	const allProperties = (props: Array<Record<string, unknown>>): Array<Record<string, unknown>> =>
		props.flatMap((p) => [p, ...allProperties(((p.options as Array<Record<string, unknown>>) || []).filter((o) => o && typeof o === 'object' && 'name' in o && 'type' in o))]);

	it('the node has no password parameter', () => {
		for (const p of allProperties(node.description.properties as unknown as Array<Record<string, unknown>>)) {
			expect(String(p.name)).not.toMatch(/password/i);
			expect((p.typeOptions as Record<string, unknown> | undefined)?.password).not.toBe(true);
		}
	});

	it('a password value in the options never reaches the API', async () => {
		const { context, httpRequestWithAuthentication } = createContext({
			params: { resource: 'document', operation: 'createFromUrl', url: 'https://example.com', test: false, pdfOptions: { userPassword: 'secret123', scale: 1 } },
			responses: [pdfResponse()],
		});
		await node.execute.call(context);
		const body = requestOf(httpRequestWithAuthentication).body as Record<string, Record<string, unknown>>;
		expect(body.options || {}).not.toHaveProperty('user_password');
	});
});

describe('request bodies', () => {
	it('Document > Create From URL with every option', async () => {
		const { context, httpRequestWithAuthentication, prepareBinaryData } = createContext({
			params: {
				resource: 'document',
				operation: 'createFromUrl',
				url: 'https://example.com',
				test: false,
				pdfOptions: {
					format: 'Letter',
					landscape: true,
					printBackground: false,
					displayHeaderFooter: true,
					headerTemplate: '<span class="title"></span>',
					footerTemplate: '<span class="pageNumber"></span>',
					marginTop: '10mm',
					marginRight: '1cm',
					marginBottom: '0.5in',
					marginLeft: '20px',
					watermarkText: 'DRAFT',
					watermarkColor: 'rgba(255, 0, 0, 0.2)',
					watermarkFontSize: '48px',
					watermarkRotation: -30,
					compressionLevel: 6,
					imageQuality: 85,
					scale: 0.8,
				},
				renderOptions: {
					pageLoadTimeoutMs: 30000,
					waitUntil: 'networkidle',
					waitForSelector: '#ready',
					waitAfterLoadMs: 500,
				},
			},
			responses: [pdfResponse('job-1', 'PDF')],
		});
		const [out] = await node.execute.call(context);
		const request = requestOf(httpRequestWithAuthentication);
		expect(request.method).toBe('POST');
		expect(request.url).toBe('https://api.pdfik.net/url-to-pdf');
		expect(request.body).toEqual({
			url: 'https://example.com',
			options: {
				format: 'Letter',
				landscape: true,
				print_background: false,
				display_header_footer: true,
				header_template: '<span class="title"></span>',
				footer_template: '<span class="pageNumber"></span>',
				scale: 0.8,
				margin: { top: '10mm', right: '1cm', bottom: '0.5in', left: '20px' },
				watermark: { text: 'DRAFT', color: 'rgba(255, 0, 0, 0.2)', font_size: '48px', rotation_degrees: -30 },
				compression: { level: 6, image_quality: 85 },
			},
			render: {
				page_load_timeout_ms: 30000,
				wait_until: 'networkidle',
				wait_for_selector: '#ready',
				wait_after_load_ms: 500,
			},
			wait: true,
		});
		expect(out).toHaveLength(1);
		expect(out[0].json).toEqual({ jobId: 'job-1', bytes: 3, test: false });
		expect(out[0].binary?.data).toBeDefined();
		expect(out[0].pairedItem).toEqual({ item: 0 });
		expect(prepareBinaryData).toHaveBeenCalledWith(Buffer.from('PDF'), 'job-1.pdf', 'application/pdf');
	});

	it('Document > Create From HTML, minimal, in test mode', async () => {
		const { context, httpRequestWithAuthentication } = createContext({
			params: { resource: 'document', operation: 'createFromHtml', html: '<h1>Hi</h1>', test: true, pdfOptions: {}, renderOptions: {} },
			responses: [pdfResponse('job-2')],
		});
		const [out] = await node.execute.call(context);
		const request = requestOf(httpRequestWithAuthentication);
		expect(request.url).toBe('https://api.pdfik.net/html-to-pdf');
		expect(request.body).toEqual({ html: '<h1>Hi</h1>', test: true, wait: true });
		expect(out[0].json).toEqual({ jobId: 'job-2', bytes: 9, test: true });
	});

	it('Document > Create From Markdown', async () => {
		const { context, httpRequestWithAuthentication } = createContext({
			params: { resource: 'document', operation: 'createFromMarkdown', markdown: '# Title', test: false, pdfOptions: { format: 'A5' } },
			responses: [pdfResponse()],
		});
		await node.execute.call(context);
		const request = requestOf(httpRequestWithAuthentication);
		expect(request.url).toBe('https://api.pdfik.net/markdown-to-pdf');
		expect(request.body).toEqual({ markdown: '# Title', options: { format: 'A5' }, wait: true });
	});

	it('rejects watermark options without text before any request', async () => {
		const { context, httpRequestWithAuthentication } = createContext({
			params: { resource: 'document', operation: 'createFromUrl', url: 'https://example.com', test: false, pdfOptions: { watermarkColor: 'red' } },
		});
		await expect(node.execute.call(context)).rejects.toThrow('Watermark Text is required');
		expect(httpRequestWithAuthentication).not.toHaveBeenCalled();
	});

	it('Screenshot > Capture URL with image options', async () => {
		const { context, httpRequestWithAuthentication, prepareBinaryData } = createContext({
			params: {
				resource: 'screenshot',
				operation: 'captureUrl',
				url: 'https://example.com',
				test: false,
				imageOptions: { format: 'jpeg', fullPage: true, quality: 70, viewportWidth: 1280 },
				renderOptions: { waitUntil: 'load' },
			},
			responses: [
				{
					statusCode: 200,
					headers: { 'content-type': 'image/jpeg', 'x-pdfik-job-id': 'job-3', 'content-disposition': 'attachment; filename=job-3.jpg' },
					body: Buffer.from('JPEG'),
				},
			],
		});
		const [out] = await node.execute.call(context);
		const request = requestOf(httpRequestWithAuthentication);
		expect(request.url).toBe('https://api.pdfik.net/url-to-image');
		expect(request.body).toEqual({
			url: 'https://example.com',
			options: { format: 'jpeg', full_page: true, quality: 70, viewport: { width: 1280, height: 768 } },
			render: { wait_until: 'load' },
			wait: true,
		});
		expect(prepareBinaryData).toHaveBeenCalledWith(Buffer.from('JPEG'), 'job-3.jpg', 'image/jpeg');
		expect(out[0].json).toEqual({ jobId: 'job-3', bytes: 4, test: false });
	});

	it('Screenshot > Capture HTML, minimal', async () => {
		const { context, httpRequestWithAuthentication } = createContext({
			params: { resource: 'screenshot', operation: 'captureHtml', html: '<p>x</p>', test: true },
			responses: [{ statusCode: 200, headers: { 'content-type': 'image/png', 'x-pdfik-job-id': 'job-4' }, body: Buffer.from('PNG') }],
		});
		const [out] = await node.execute.call(context);
		expect(requestOf(httpRequestWithAuthentication).body).toEqual({ html: '<p>x</p>', test: true, wait: true });
		expect(out[0].binary?.data).toMatchObject({ fileName: 'job-4.png', mimeType: 'image/png' });
	});

	it('E-Invoice > Create from text with a template', async () => {
		const { context, httpRequestWithAuthentication } = createContext({
			params: {
				resource: 'eInvoice',
				operation: 'create',
				xmlSource: 'text',
				xml: '<rsm:CrossIndustryInvoice/>',
				profile: 'basic',
				templateId: ' tpl-1 ',
				test: false,
			},
			responses: [
				{
					...pdfResponse('job-5'),
					headers: { ...pdfResponse('job-5').headers, 'x-pdfik-warning': 'profile note' },
				},
			],
		});
		const [out] = await node.execute.call(context);
		const request = requestOf(httpRequestWithAuthentication);
		expect(request.url).toBe('https://api.pdfik.net/einvoice-to-pdf');
		expect(request.body).toEqual({ xml: '<rsm:CrossIndustryInvoice/>', profile: 'basic', template_id: 'tpl-1', wait: true });
		expect(out[0].json).toEqual({ jobId: 'job-5', bytes: 9, test: false, warning: 'profile note' });
	});

	it('E-Invoice > Create from a binary field strips the BOM', async () => {
		const { context, httpRequestWithAuthentication } = createContext({
			params: { resource: 'eInvoice', operation: 'create', xmlSource: 'binary', binaryPropertyName: 'data', profile: 'en16931', templateId: '', test: true },
			binary: Buffer.from('﻿<x/>', 'utf8'),
			responses: [pdfResponse()],
		});
		await node.execute.call(context);
		expect(requestOf(httpRequestWithAuthentication).body).toEqual({ xml: '<x/>', profile: 'en16931', test: true, wait: true });
	});

	it('Job > Get', async () => {
		const { context, httpRequestWithAuthentication } = createContext({
			params: { resource: 'job', operation: 'get', jobId: 'abc' },
			responses: [jsonResponse(200, { status: 'done', test: false })],
		});
		const [out] = await node.execute.call(context);
		const request = requestOf(httpRequestWithAuthentication);
		expect(request.method).toBe('GET');
		expect(request.url).toBe('https://api.pdfik.net/jobs/abc');
		expect(request.body).toBeUndefined();
		expect(out[0].json).toEqual({ jobId: 'abc', status: 'done', test: false });
	});

	it('Job > Download', async () => {
		const { context, httpRequestWithAuthentication } = createContext({
			params: { resource: 'job', operation: 'download', jobId: 'abc' },
			responses: [pdfResponse('abc', 'PDFDATA')],
		});
		const [out] = await node.execute.call(context);
		expect(requestOf(httpRequestWithAuthentication).url).toBe('https://api.pdfik.net/jobs/abc/download');
		expect(out[0].json).toEqual({ jobId: 'abc', bytes: 7 });
		expect(out[0].binary?.data).toBeDefined();
	});

	it('Account > Get', async () => {
		const account = { plan: 'pro', key: { name: null } };
		const { context, httpRequestWithAuthentication } = createContext({
			params: { resource: 'account', operation: 'get' },
			responses: [jsonResponse(200, account)],
		});
		const [out] = await node.execute.call(context);
		expect(requestOf(httpRequestWithAuthentication).url).toBe('https://api.pdfik.net/account');
		expect(out[0].json).toEqual(account);
	});
});

describe('tool mode and errors', () => {
	it('queues the job and returns JSON only when run as an AI Agent tool', async () => {
		const { context, prepareBinaryData, httpRequestWithAuthentication } = createContext({
			nodeType: '@pdfik/n8n-nodes-pdfik.pdfikTool',
			params: { resource: 'document', operation: 'createFromUrl', url: 'https://example.com', test: true },
			responses: [jsonResponse(202, { job_id: 'job-6', status: 'queued', detail: 'Job queued' })],
		});
		const [out] = await node.execute.call(context);
		expect(out[0].binary).toBeUndefined();
		expect(out[0].json).toEqual({ jobId: 'job-6', status: 'queued', test: true });
		expect((requestOf(httpRequestWithAuthentication).body as { wait?: boolean }).wait).toBe(false);
		expect(prepareBinaryData).not.toHaveBeenCalled();
	});

	it('returns the e-invoice profile warning without the queued sentence in tool mode', async () => {
		const warning = "Profile 'minimum' does not carry a complete invoice: the embedded XML is accompanying data only and is NOT a legally sufficient e-invoice in DE/FR. Use 'basic', 'en16931' or 'extended' for a full invoice.";
		const { context } = createContext({
			nodeType: '@pdfik/n8n-nodes-pdfik.pdfikTool',
			params: { resource: 'eInvoice', operation: 'create', xmlSource: 'text', xml: '<x/>', profile: 'minimum', test: true },
			responses: [jsonResponse(202, { job_id: 'job-8', status: 'queued', detail: `Job successfully sent to processing queue. ${warning}` })],
		});
		const [out] = await node.execute.call(context);
		expect(out[0].json.warning).toBe(warning);
	});

	it('refuses Job > Download as an AI Agent tool without spending a download', async () => {
		const { context, httpRequestWithAuthentication } = createContext({
			nodeType: '@pdfik/n8n-nodes-pdfik.pdfikTool',
			params: { resource: 'job', operation: 'download', jobId: 'job-7' },
			responses: [],
		});
		await expect(node.execute.call(context)).rejects.toThrow('AI Agent tool cannot pass on');
		expect(httpRequestWithAuthentication).not.toHaveBeenCalled();
	});

	it('throws a readable API error', async () => {
		const { context } = createContext({
			params: { resource: 'account', operation: 'get' },
			responses: [
				jsonResponse(401, { type: 'https://docs.pdfik.net/error-codes#401', title: 'Invalid API key', status: 401, detail: 'Invalid API key' }),
			],
		});
		await expect(node.execute.call(context)).rejects.toThrow(
			'[401] Unauthorized — Invalid API key (https://docs.pdfik.net/error-codes#401)',
		);
	});

	it('continues on fail with one error item per failed input, paired to it', async () => {
		const { context } = createContext({
			continueOnFail: true,
			items: [{ json: {} }, { json: {} }],
			params: [
				{ resource: 'document', operation: 'createFromUrl', url: 'https://example.com', test: true },
				{ resource: 'document', operation: 'createFromUrl', url: 'https://example.com', test: true },
			],
			responses: [
				jsonResponse(503, {
					type: 'https://docs.pdfik.net/error-codes#sync-timeout',
					title: 'Service Unavailable - Render Did Not Finish In Time',
					status: 503,
					error: 'SYNC_TIMEOUT',
					detail: 'The render did not finish within 45 seconds.',
				}),
				pdfResponse('job-7'),
			],
		});
		const [out] = await node.execute.call(context);
		expect(out).toHaveLength(2);
		expect(out[0].pairedItem).toEqual({ item: 0 });
		expect(String(out[0].json.error)).toBe(
			'[503] Service Unavailable - Render Did Not Finish In Time — The render did not finish within 45 seconds. (https://docs.pdfik.net/error-codes#sync-timeout)',
		);
		expect(out[1].pairedItem).toEqual({ item: 1 });
		expect(out[1].json.jobId).toBe('job-7');
	});

	it('refuses a JSON answer where the file was expected', async () => {
		const { context } = createContext({
			params: { resource: 'document', operation: 'createFromUrl', url: 'https://example.com', test: false },
			responses: [jsonResponse(202, { job_id: 'x', status: 'queued', detail: 'queued' })],
		});
		await expect(node.execute.call(context)).rejects.toThrow('Expected the finished file');
	});
});
