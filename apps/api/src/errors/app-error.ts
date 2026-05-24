export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly expose: boolean;

  constructor(code: string, message: string, statusCode = 500, expose = statusCode < 500) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = statusCode;
    this.expose = expose;
  }

  static unauthorized(message = "Authentication is required"): AppError {
    return new AppError("UNAUTHORIZED", message, 401);
  }

  static badRequest(message = "Invalid request"): AppError {
    return new AppError("BAD_REQUEST", message, 400);
  }

  static conflict(message = "Resource already exists"): AppError {
    return new AppError("CONFLICT", message, 409);
  }

  static forbidden(message = "You do not have permission to perform this action"): AppError {
    return new AppError("FORBIDDEN", message, 403);
  }

  static paymentRequired(message = "Plan limit exceeded"): AppError {
    return new AppError("PAYMENT_REQUIRED", message, 402);
  }

  static notFound(message = "Resource not found"): AppError {
    return new AppError("NOT_FOUND", message, 404);
  }

  static badGateway(message = "Upstream provider request failed"): AppError {
    return new AppError("BAD_GATEWAY", message, 502);
  }

  static serviceUnavailable(message = "Upstream provider is unavailable"): AppError {
    return new AppError("SERVICE_UNAVAILABLE", message, 503);
  }
}
