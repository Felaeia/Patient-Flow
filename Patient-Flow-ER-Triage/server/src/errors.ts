export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}
export function conflict(message: string): never {
  throw new ApiError(409, "CONFLICT", message);
}
export function missing(): never {
  throw new ApiError(404, "NOT_FOUND", "Record was not found");
}
