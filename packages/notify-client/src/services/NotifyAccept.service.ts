import type {
  NotifyAcceptResult,
  OwnablesInboxItem,
} from "../types/NotifyClient";

export interface NotifyAcceptServiceDeps {
  fetchFn?: (input: string, init?: RequestInit) => Promise<{ ok: boolean; status: number }>;
}

export class NotifyAcceptService {
  private readonly fetchFn: (
    input: string,
    init?: RequestInit
  ) => Promise<{ ok: boolean; status: number }>;

  constructor(deps: NotifyAcceptServiceDeps = {}) {
    this.fetchFn = deps.fetchFn ?? ((input, init) => fetch(input, init));
  }

  async accept(item: OwnablesInboxItem): Promise<NotifyAcceptResult> {
    const method = item.payload.accept.method ?? "GET";
    const response = await this.fetchFn(item.payload.accept.url, {
      method,
    });

    return {
      ok: response.ok,
      status: response.status,
    };
  }
}
