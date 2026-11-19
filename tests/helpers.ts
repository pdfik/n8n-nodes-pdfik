import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';

// Placeholder only: no real key ever appears in this repository.
export const PLACEHOLDER_KEY = 'sk_live_YOUR_API_KEY';

export interface MockResponse {
	statusCode: number;
	headers?: Record<string, string>;
	body?: Buffer | string;
}

export interface MockContext {
	context: IExecuteFunctions;
	httpRequestWithAuthentication: jest.Mock;
	prepareBinaryData: jest.Mock;
}

export function pdfResponse(jobId = 'job-123', bytes = 'PDF-BYTES'): MockResponse {
	return {
		statusCode: 200,
		headers: {
			'content-type': 'application/pdf',
			'x-pdfik-job-id': jobId,
			'content-disposition': `attachment; filename=${jobId}.pdf`,
		},
		body: Buffer.from(bytes),
	};
}

export function jsonResponse(statusCode: number, body: unknown, headers: Record<string, string> = {}): MockResponse {
	return {
		statusCode,
		headers: { 'content-type': 'application/json', ...headers },
		body: Buffer.from(JSON.stringify(body)),
	};
}

/**
 * A minimal IExecuteFunctions: parameters come from `params` (per item when an array),
 * every HTTP call answers with the next queued response.
 */
export function createContext(options: {
	params: IDataObject | IDataObject[];
	responses?: MockResponse[];
	items?: INodeExecutionData[];
	nodeType?: string;
	continueOnFail?: boolean;
	binary?: Buffer;
}): MockContext {
	const responses = [...(options.responses ?? [])];
	const items = options.items ?? [{ json: {} }];
	const httpRequestWithAuthentication = jest.fn(async () => {
		const next = responses.shift();
		if (!next) throw new Error('No mocked response left');
		return { statusCode: next.statusCode, headers: next.headers ?? {}, body: next.body ?? Buffer.alloc(0) };
	});
	const prepareBinaryData = jest.fn(async (buffer: Buffer, fileName?: string, mimeType?: string) => ({
		data: buffer.toString('base64'),
		fileName,
		mimeType: mimeType ?? 'application/octet-stream',
	}));

	const node = {
		id: 'node-id',
		name: 'PDFik',
		type: options.nodeType ?? '@pdfik/n8n-nodes-pdfik.pdfik',
		typeVersion: 1,
		position: [0, 0],
		parameters: {},
	};

	const context = {
		getInputData: () => items,
		getNode: () => node,
		getNodeParameter: (name: string, itemIndex: number, fallback?: unknown) => {
			const params = Array.isArray(options.params) ? options.params[itemIndex] : options.params;
			if (params && Object.prototype.hasOwnProperty.call(params, name)) return params[name];
			if (fallback !== undefined) return fallback;
			throw new Error(`Missing parameter ${name}`);
		},
		getCredentials: async () => ({ apiKey: PLACEHOLDER_KEY, baseUrl: 'https://api.pdfik.net/' }),
		continueOnFail: () => options.continueOnFail === true,
		helpers: {
			httpRequestWithAuthentication,
			prepareBinaryData,
			assertBinaryData: jest.fn(() => ({ data: '', mimeType: 'application/xml' })),
			getBinaryDataBuffer: jest.fn(async () => options.binary ?? Buffer.alloc(0)),
		},
	} as unknown as IExecuteFunctions;

	return { context, httpRequestWithAuthentication, prepareBinaryData };
}

/** The options object of the n-th HTTP call. */
export function requestOf(mock: jest.Mock, call = 0): IDataObject {
	return mock.mock.calls[call][1] as IDataObject;
}
