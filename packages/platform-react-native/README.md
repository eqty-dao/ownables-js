# @ownables/platform-react-native

React Native platform adapters for `@ownables/core`.

This package provides:

- `RNStateStore` (`StateStore` adapter)
- `RNPackageAssetIO` (`PackageAssetIO` adapter)
- `RNOwnableRPC` + `createRNRuntimeRpcProvider()` (`OwnableRPC` adapter)
- `createRNRuntimeSourceProvider()` (`RuntimeSourceProvider` compatibility helper)

## Runtime model

`RNOwnableRPC` delegates Ownable Host ABI calls to a native runtime bridge.
The native side is expected to execute WASM via WAMR (or an equivalent engine)
and exchange CBOR payloads as bytes.

## Notes

- This package is dependency-injection based and does not ship a built-in native module.
- Wallet integrations should provide bridge + storage backends.
