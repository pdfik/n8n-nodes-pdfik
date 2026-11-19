import { mapApiError, redactKeys } from '../nodes/Pdfik/GenericFunctions';

const buf = (value: unknown) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));

describe('mapApiError', () => {
	it('reads an RFC 7807 body with a string detail', () => {
		const mapped = mapApiError(
			402,
			buf({
				type: 'https://docs.pdfik.net/error-codes#quota-exceeded',
				title: 'Payment Required - Quota Exceeded',
				status: 402,
				error: 'QUOTA_EXCEEDED',
				detail: "Monthly generation quota of 100 PDFs for plan 'free' exceeded.",
			}),
		);
		expect(mapped.message).toBe(
			"[402] Payment Required - Quota Exceeded — Monthly generation quota of 100 PDFs for plan 'free' exceeded. (https://docs.pdfik.net/error-codes#quota-exceeded)",
		);
		expect(mapped.errorCode).toBe('QUOTA_EXCEEDED');
	});

	it('uses the status title when the generic handler copied detail into title', () => {
		const mapped = mapApiError(
			401,
			buf({ type: 'https://docs.pdfik.net/error-codes#401', title: 'Invalid API key', status: 401, detail: 'Invalid API key' }),
		);
		expect(mapped.message).toBe('[401] Unauthorized — Invalid API key (https://docs.pdfik.net/error-codes#401)');
	});

	it('takes the first msg of a 422 validation list, with its field path', () => {
		const mapped = mapApiError(
			422,
			buf({
				type: 'https://docs.pdfik.net/error-codes#validation-error',
				title: 'Unprocessable Entity - Request Validation Error',
				status: 422,
				detail: [
					{ loc: ['body', 'options', 'scale'], msg: 'Value error, options.scale must be between 0.5 and 2.0', type: 'value_error' },
					{ loc: ['body', 'url'], msg: 'Field required', type: 'missing' },
				],
			}),
		);
		expect(mapped.detail).toBe('options.scale: Value error, options.scale must be between 0.5 and 2.0 (and 1 more)');
		expect(mapped.link).toBe('https://docs.pdfik.net/error-codes#validation-error');
		expect(mapped.message.startsWith('[422] Unprocessable Entity - Request Validation Error — options.scale')).toBe(true);
	});

	it('reads the 402 card-wall object', () => {
		const mapped = mapApiError(
			402,
			buf({
				type: 'https://docs.pdfik.net/error-codes#402',
				title: 'HTTP Error',
				status: 402,
				detail: {
					error: 'PAYMENT_METHOD_REQUIRED',
					message: 'No active payment method on file. Please add a card at https://pdfik.net/dashboard/billing',
					add_card_url: 'https://pdfik.net/dashboard/billing',
				},
			}),
		);
		expect(mapped.message).toBe(
			'[402] Payment Required — No active payment method on file. Please add a card at https://pdfik.net/dashboard/billing (https://docs.pdfik.net/error-codes#402)',
		);
		expect(mapped.errorCode).toBe('PAYMENT_METHOD_REQUIRED');
	});

	it('reads the non-RFC 413 body of the request-size limit', () => {
		const mapped = mapApiError(
			413,
			buf({ error: 'PAYLOAD_TOO_LARGE', limit_bytes: 5242880, detail: 'Request payload exceeds 5MB limit.' }),
		);
		expect(mapped.message).toBe(
			'[413] Payload Too Large — Request payload exceeds 5MB limit. (https://docs.pdfik.net/error-codes#413)',
		);
		expect(mapped.errorCode).toBe('PAYLOAD_TOO_LARGE');
	});

	it('falls back to the status for a non-JSON body', () => {
		const mapped = mapApiError(502, buf('<html>Bad gateway</html>'));
		expect(mapped.message).toBe(
			'[502] Bad Gateway — Unexpected response from the PDFik API (https://docs.pdfik.net/error-codes#other-http-statuses)',
		);
	});

	it('never trusts a type link outside the PDFik docs', () => {
		const mapped = mapApiError(400, buf({ type: 'https://evil.example/x', title: 'Bad', status: 400, detail: 'nope' }));
		expect(mapped.link).toBe('https://docs.pdfik.net/error-codes#400');
	});

	it('passes Retry-After through', () => {
		const mapped = mapApiError(
			429,
			buf({ type: 'https://docs.pdfik.net/error-codes#concurrency-limit', title: 'Too Many Requests - Concurrency Limit', status: 429, detail: 'busy' }),
			{ 'Retry-After': '5' },
		);
		expect(mapped.retryAfter).toBe('5');
	});

	it('never includes an API key in the text', () => {
		const mapped = mapApiError(400, buf({ title: 'Bad Request', status: 400, detail: 'key sk_live_YOUR_API_KEY rejected' }));
		expect(mapped.message).not.toContain('YOUR_API_KEY');
		expect(redactKeys('sk_test_abc123')).toBe('sk_test_***');
	});
});
