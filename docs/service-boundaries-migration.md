# Service-boundaries migration

Version 0.10.0 adopts the class-based service API introduced by the
service-boundaries refactor. This is a source-compatible migration only for
consumers that already instantiate the new service classes; it intentionally
does not retain aliases for the previous function exports.

## Update consumers

- Replace imports of the former core, builder, and platform function APIs with
  the relevant service class and call the equivalent method on an instance.
- Construct `OwnableService` with its explicit dependency graph. Platform
  runtime providers may still use their documented defaults where appropriate.
- Import `calculateOwnablePackageCid` from `@ownables/core/utils`; it is no
  longer exposed from a platform package or the core package root.
- Remove uses of the retired notification packages and their exports.

Runtime behavior, HTTP and SSE interactions, persisted/on-chain data, and
public-event indexing semantics are unchanged by this migration.
