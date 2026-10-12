class AroFloApiError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'AroFloApiError';
    Object.assign(this, details);
  }
}

class AroFloAuthError extends AroFloApiError {
  constructor(message, details) {
    super(message, details);
    this.name = 'AroFloAuthError';
  }
}

class AroFloRateLimitError extends AroFloApiError {
  constructor(message, details) {
    super(message, details);
    this.name = 'AroFloRateLimitError';
  }
}

function isRetryable(err) {
  return err instanceof AroFloRateLimitError || (err.statusCode && err.statusCode >= 500);
}

module.exports = { AroFloApiError, AroFloAuthError, AroFloRateLimitError, isRetryable };
