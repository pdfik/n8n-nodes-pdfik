import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { nodeProperties } from './descriptions';
import {
	assertFileResponse,
	buildImageOptions,
	buildPdfOptions,
	buildRenderOptions,
	fileFromResponse,
	finishCreateBody,
	parseJsonBody,
	pdfikRequest,
	PdfikInputError,
	profileWarning,
} from './GenericFunctions';

interface CreateRequest {
	path: string;
	body: IDataObject;
	defaultMimeType: string;
}

/** When n8n runs a node as an AI Agent tool its type gets a `Tool` suffix. */
function isToolMode(context: IExecuteFunctions): boolean {
	return context.getNode().type.endsWith('Tool');
}

function inputError(context: IExecuteFunctions, error: unknown, itemIndex: number): never {
	if (error instanceof PdfikInputError) {
		throw new NodeOperationError(context.getNode(), error.message, { itemIndex });
	}
	throw error;
}

async function readXml(context: IExecuteFunctions, itemIndex: number): Promise<string> {
	const source = context.getNodeParameter('xmlSource', itemIndex) as string;
	let xml: string;
	if (source === 'binary') {
		const property = context.getNodeParameter('binaryPropertyName', itemIndex) as string;
		context.helpers.assertBinaryData(itemIndex, property);
		const buffer = await context.helpers.getBinaryDataBuffer(itemIndex, property);
		xml = buffer.toString('utf8');
	} else {
		xml = context.getNodeParameter('xml', itemIndex) as string;
	}
	// A UTF-8 byte-order mark in front of the prolog is not part of the XML.
	xml = xml.replace(/^\uFEFF/, '');
	if (xml.trim() === '') {
		throw new NodeOperationError(context.getNode(), 'The invoice XML is empty', { itemIndex });
	}
	return xml;
}

async function buildCreateRequest(
	context: IExecuteFunctions,
	resource: string,
	operation: string,
	itemIndex: number,
): Promise<CreateRequest | undefined> {
	const test = context.getNodeParameter('test', itemIndex, false) as boolean;

	if (resource === 'document') {
		let options: IDataObject | undefined = undefined;
		let render: IDataObject | undefined = undefined;
		try {
			options = buildPdfOptions(context.getNodeParameter('pdfOptions', itemIndex, {}) as IDataObject);
			render = buildRenderOptions(context.getNodeParameter('renderOptions', itemIndex, {}) as IDataObject);
		} catch (error) {
			inputError(context, error, itemIndex);
		}
		const parts = { test, options, render };
		if (operation === 'createFromUrl') {
			const url = context.getNodeParameter('url', itemIndex) as string;
			return { path: '/url-to-pdf', body: finishCreateBody({ url }, parts), defaultMimeType: 'application/pdf' };
		}
		if (operation === 'createFromHtml') {
			const html = context.getNodeParameter('html', itemIndex) as string;
			return { path: '/html-to-pdf', body: finishCreateBody({ html }, parts), defaultMimeType: 'application/pdf' };
		}
		if (operation === 'createFromMarkdown') {
			const markdown = context.getNodeParameter('markdown', itemIndex) as string;
			return {
				path: '/markdown-to-pdf',
				body: finishCreateBody({ markdown }, parts),
				defaultMimeType: 'application/pdf',
			};
		}
	}

	if (resource === 'screenshot') {
		const options = buildImageOptions(context.getNodeParameter('imageOptions', itemIndex, {}) as IDataObject);
		const render = buildRenderOptions(context.getNodeParameter('renderOptions', itemIndex, {}) as IDataObject);
		const defaultMimeType = options?.format === 'jpeg' ? 'image/jpeg' : 'image/png';
		const parts = { test, options, render };
		if (operation === 'captureUrl') {
			const url = context.getNodeParameter('url', itemIndex) as string;
			return { path: '/url-to-image', body: finishCreateBody({ url }, parts), defaultMimeType };
		}
		if (operation === 'captureHtml') {
			const html = context.getNodeParameter('html', itemIndex) as string;
			return { path: '/html-to-image', body: finishCreateBody({ html }, parts), defaultMimeType };
		}
	}

	if (resource === 'eInvoice' && operation === 'create') {
		const xml = await readXml(context, itemIndex);
		const profile = context.getNodeParameter('profile', itemIndex, 'en16931') as string;
		const templateId = (context.getNodeParameter('templateId', itemIndex, '') as string).trim();
		const body: IDataObject = { xml, profile };
		if (templateId) body.template_id = templateId;
		return { path: '/einvoice-to-pdf', body: finishCreateBody(body, { test }), defaultMimeType: 'application/pdf' };
	}

	return undefined;
}

export class Pdfik implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'PDFik',
		name: 'pdfik',
		icon: { light: 'file:pdfik.svg', dark: 'file:pdfik.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Turn a URL/HTML or Markdown into a PDF or screenshot and create e-invoices with PDFik',
		defaults: {
			name: 'PDFik',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'pdfikApi',
				required: true,
			},
		],
		properties: nodeProperties,
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const toolMode = isToolMode(this);

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;

				if (resource === 'account' && operation === 'get') {
					const response = await pdfikRequest.call(this, 'GET', '/account', i);
					returnData.push({ json: (parseJsonBody(response.body) ?? {}) as IDataObject, pairedItem: { item: i } });
					continue;
				}

				if (resource === 'job') {
					const jobId = (this.getNodeParameter('jobId', i) as string).trim();
					if (!jobId) throw new NodeOperationError(this.getNode(), 'Job ID is required', { itemIndex: i });
					const encoded = encodeURIComponent(jobId);

					if (operation === 'get') {
						const response = await pdfikRequest.call(this, 'GET', `/jobs/${encoded}`, i);
						const status = (parseJsonBody(response.body) ?? {}) as IDataObject;
						returnData.push({ json: { jobId, ...status }, pairedItem: { item: i } });
						continue;
					}

					if (operation === 'download') {
						if (toolMode) {
							// The agent cannot receive the file, and each download spends one of the
							// file's 3 attempts: refuse instead of spending one for nothing.
							throw new NodeOperationError(
								this.getNode(),
								'Job > Download returns a file, which an AI Agent tool cannot pass on. Download the job in a regular workflow step.',
								{ itemIndex: i },
							);
						}
						const response = await pdfikRequest.call(this, 'GET', `/jobs/${encoded}/download`, i);
						const file = fileFromResponse(response, jobId, 'application/pdf');
						const json: IDataObject = { jobId, bytes: response.body.length };
						const binary = await this.helpers.prepareBinaryData(response.body, file.fileName, file.mimeType);
						returnData.push({ json, binary: { data: binary }, pairedItem: { item: i } });
						continue;
					}
				}

				const request = await buildCreateRequest(this, resource, operation, i);
				if (!request) {
					throw new NodeOperationError(
						this.getNode(),
						`The operation "${operation}" is not supported for "${resource}"`,
						{ itemIndex: i },
					);
				}

				if (toolMode) {
					// An AI Agent reads JSON only: queue the job instead of waiting for a file it cannot
					// receive (a sync file response would spend one of the file's 3 downloads).
					const queued = await pdfikRequest.call(this, 'POST', request.path, i, { ...request.body, wait: false });
					const data = (parseJsonBody(queued.body) ?? {}) as IDataObject;
					const json: IDataObject = { jobId: data.job_id, status: data.status, test: request.body.test === true };
					const warning = profileWarning(data.detail);
					if (resource === 'eInvoice' && warning && /minimum|basicwl/i.test(String(request.body.profile ?? ''))) {
						json.warning = warning;
					}
					returnData.push({ json, pairedItem: { item: i } });
					continue;
				}

				const response = await pdfikRequest.call(this, 'POST', request.path, i, request.body);
				const problem = assertFileResponse(response);
				if (problem) throw new NodeOperationError(this.getNode(), problem, { itemIndex: i });

				const file = fileFromResponse(response, '', request.defaultMimeType);
				const json: IDataObject = {
					jobId: file.jobId,
					bytes: response.body.length,
					test: request.body.test === true,
				};
				if (file.warning) json.warning = file.warning;

				const binary = await this.helpers.prepareBinaryData(response.body, file.fileName, file.mimeType);
				returnData.push({ json, binary: { data: binary }, pairedItem: { item: i } });
			} catch (error) {
				if (this.continueOnFail()) {
					const json: IDataObject = { error: error instanceof Error ? error.message : String(error) };
					const description = (error as { description?: unknown }).description;
					if (typeof description === 'string' && description) json.description = description;
					const httpCode = (error as { httpCode?: unknown }).httpCode;
					if (httpCode) json.httpCode = String(httpCode);
					returnData.push({ json, pairedItem: { item: i } });
					continue;
				}
				// An API error keeps its readable line and HTTP status; anything else is wrapped.
				if (error instanceof NodeApiError) {
					throw new NodeApiError(this.getNode(), { message: error.message } as JsonObject, {
						itemIndex: i,
						message: error.message,
						description: error.description ?? undefined,
						httpCode: error.httpCode ?? undefined,
					});
				}
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
			}
		}

		return [returnData];
	}
}
