interface TypedCosmWasmMethod {
  required: string[];
  properties: {
    [methodName: string]: object;
  };
}

export interface TypedCosmWasmMsg {
  title: string;
  oneOf: Array<TypedCosmWasmMethod>;
}
