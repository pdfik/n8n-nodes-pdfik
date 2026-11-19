// Kept in step with package.json "version" (a unit test compares the two).
// Sent as `X-PDFik-Client: n8n/<version>` so the API can tell n8n traffic apart.
export const PACKAGE_VERSION = '0.1.2';

export const CLIENT_HEADER_VALUE = `n8n/${PACKAGE_VERSION}`;
