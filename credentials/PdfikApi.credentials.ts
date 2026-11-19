import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

import { CLIENT_HEADER_VALUE } from '../nodes/Pdfik/version';

export class PdfikApi implements ICredentialType {
	name = 'pdfikApi';

	displayName = 'PDFik API';

	icon: Icon = { light: 'file:../nodes/Pdfik/pdfik.svg', dark: 'file:../nodes/Pdfik/pdfik.dark.svg' };

	documentationUrl = 'https://docs.pdfik.net/integrations/n8n';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			description: 'Your PDFik API key, created in the dashboard under API Keys',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://api.pdfik.net',
			description: 'Address of the PDFik API. Keep the default unless PDFik support told you otherwise.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				'X-API-Key': '={{$credentials.apiKey}}',
			},
		},
	};

	// GET /account checks the key without creating a job or charging anything.
	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/account',
			method: 'GET',
			headers: {
				'X-PDFik-Client': CLIENT_HEADER_VALUE,
			},
		},
	};
}
