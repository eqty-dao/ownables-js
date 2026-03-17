declare module '@babel/core' {
  export interface TransformResult {
    code?: string | null;
  }

  export function transformSync(
    code: string,
    options?: Record<string, unknown>
  ): TransformResult | null;

  export type PluginObj = {
    name?: string;
    visitor?: Record<string, unknown>;
  };
}
