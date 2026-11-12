export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;
  public readonly isOperational: boolean;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    details?: unknown,
    isOperational = true
  ) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = isOperational;
  }
}

export const Errors = {
  badRequest: (message: string, code = 'BAD_REQUEST', details?: unknown) =>
    new AppError(400, code, message, details),
  unauthorized: (message = 'Authentication required.', code = 'UNAUTHORIZED') =>
    new AppError(401, code, message),
  forbidden: (message = 'You do not have permission to perform this action.', code = 'FORBIDDEN') =>
    new AppError(403, code, message),
  notFound: (message = 'Requested resource was not found.', code = 'NOT_FOUND') =>
    new AppError(404, code, message),
  conflict: (message: string, code = 'CONFLICT') =>
    new AppError(409, code, message),
  tooManyRequests: (message: string, details?: unknown) =>
    new AppError(429, 'RATE_LIMITED', message, details),
  serviceUnavailable: (message: string, code = 'EXTERNAL_PROVIDER_UNCONFIGURED', details?: unknown) =>
    new AppError(503, code, message, details),
};
