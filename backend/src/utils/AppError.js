/**
 * Typed application error carrying an HTTP status and a stable machine-readable
 * code. Throwing `AppError` lets the central error handler set the status and
 * build the `{ error: { code, message } }` envelope deterministically, instead
 * of regex-matching free-text messages to guess a status.
 *
 * @example throw new AppError('File not found', 404, 'FILE_NOT_FOUND');
 */
export class AppError extends Error {
	constructor(message, statusCode = 400, code = 'BAD_REQUEST') {
		super(message);
		this.name = 'AppError';
		this.status = statusCode;
		this.statusCode = statusCode;
		this.code = code;
		this.expose = true; // message is safe to send to the client
	}
}

// Convenience factories for the common cases, so call sites stay terse.
export const badRequest = (message, code = 'BAD_REQUEST') => new AppError(message, 400, code);
export const unauthorized = (message = 'Authentication required', code = 'UNAUTHORIZED') =>
	new AppError(message, 401, code);
export const forbidden = (message = 'Forbidden', code = 'FORBIDDEN') => new AppError(message, 403, code);
export const notFound = (message = 'Not found', code = 'NOT_FOUND') => new AppError(message, 404, code);
export const conflict = (message, code = 'CONFLICT') => new AppError(message, 409, code);
export const unsupportedMediaType = (message, code = 'UNSUPPORTED_MEDIA_TYPE') =>
	new AppError(message, 415, code);
