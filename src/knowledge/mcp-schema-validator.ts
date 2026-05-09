export interface SchemaValidationResult<T> {
  ok: boolean;
  value: T | null;
  errors: string[];
  trustStatus: 'trusted' | 'untrusted';
}

export interface SchemaValidator<T> {
  validate(value: unknown): SchemaValidationResult<T>;
}

export function validateRecord(value: unknown, source: string): SchemaValidationResult<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalid(`${source} must be an object`);
  }
  return valid(value as Record<string, unknown>);
}

export function valid<T>(value: T): SchemaValidationResult<T> {
  return {
    ok: true,
    value,
    errors: [],
    trustStatus: 'trusted',
  };
}

export function invalid<T>(...errors: string[]): SchemaValidationResult<T> {
  return {
    ok: false,
    value: null,
    errors,
    trustStatus: 'untrusted',
  };
}

export function mergeValidation<T>(value: T, errors: string[]): SchemaValidationResult<T> {
  return errors.length > 0 ? invalid(...errors) : valid(value);
}
