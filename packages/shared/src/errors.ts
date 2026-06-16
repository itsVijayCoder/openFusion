export class FusionHarnessError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 500,
  ) {
    super(message);
    this.name = "FusionHarnessError";
  }
}
