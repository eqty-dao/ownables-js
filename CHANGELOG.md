# [0.7.0](https://github.com/eqty-dao/ownables-js/compare/v0.6.1...v0.7.0) (2026-06-18)


### Bug Fixes

* add authority API and QC remediations ([3be265b](https://github.com/eqty-dao/ownables-js/commit/3be265b8162e584424b5365fdd44ecc78f9bf671))
* **core:** make package-root ESM imports node24-resolvable ([0bead1a](https://github.com/eqty-dao/ownables-js/commit/0bead1a8ecc0b8c9d7f03bf88a3573b404a18210))
* **core:** preserve partial replay progress for stale classification ([fbb3ba9](https://github.com/eqty-dao/ownables-js/commit/fbb3ba9d944531504cb25342acad02ac718dadfc))
* **notify-core:** use explicit js export specifiers for esm ([7a80046](https://github.com/eqty-dao/ownables-js/commit/7a800467aff3d2aac52bcb702cb14e65240fb347))
* **notify-publisher:** align package root exports with built output ([1760196](https://github.com/eqty-dao/ownables-js/commit/176019664681ddf749947f1c915cd174c5c67fef))
* **notify-publisher:** make notify-core a peer dependency ([08a9cd0](https://github.com/eqty-dao/ownables-js/commit/08a9cd0d32580c3ffdb8e2c4f3424887acefed45))
* **platform-node:** make core dependency consumable via portal ([51bc397](https://github.com/eqty-dao/ownables-js/commit/51bc3972fed8e90f78ce1ac5107e2bffb9a5779d))
* **platform-node:** restore package-root consumability ([4521552](https://github.com/eqty-dao/ownables-js/commit/452155267ad12b6b1a0c4f6eac033b300a150207))


### Features

* add replay, cid, and notify hub contracts ([b8edc55](https://github.com/eqty-dao/ownables-js/commit/b8edc554ea9d985e9302ff023b26f6f3b8010791))
* **notify:** target Reown accounts and urls ([10e13d2](https://github.com/eqty-dao/ownables-js/commit/10e13d299cdc21375a5883706f0d146692b7d9f5))

## [0.6.1](https://github.com/eqty-dao/ownables-js/compare/v0.6.0...v0.6.1) (2026-05-25)


### Bug Fixes

* yarn ([c7c66b5](https://github.com/eqty-dao/ownables-js/commit/c7c66b5a71a082c0340dd2919105f4b29c2bacb0))

# [0.6.0](https://github.com/eqty-dao/ownables-js/compare/v0.5.0...v0.6.0) (2026-05-25)


### Bug Fixes

* release ([aa9b6b8](https://github.com/eqty-dao/ownables-js/commit/aa9b6b8a6adc779089e4f7c2f4c92890b3dc25c2))
* **release:** fix rust schema generation step ([17b8a74](https://github.com/eqty-dao/ownables-js/commit/17b8a74886daf8208fd224195bef1e8efa3dca5e))
* tighten eslint config and cleanup lint issues ([e90a7a1](https://github.com/eqty-dao/ownables-js/commit/e90a7a1e192bb8198d5d5f0e5d3df4ab5234ee54))


### Features

* add public event support across runtimes ([3bda2b0](https://github.com/eqty-dao/ownables-js/commit/3bda2b0a43359821da695559d0924739f3e3c4d0))
* **platform-react-native:** add ownable persistence service and docs ([8c85e87](https://github.com/eqty-dao/ownables-js/commit/8c85e875a2c68e38e5c09865cbc7c54b3ce2ceb0))
* **platform-react-native:** add RN adapters and bridge contract ([2a581fd](https://github.com/eqty-dao/ownables-js/commit/2a581fd089ec914c73a8d94f861389145f8a102c))

## [0.5.1](https://github.com/eqty-dao/ownables-js/compare/v0.5.0...v0.5.1) (2026-04-06)


### Bug Fixes

* release ([aa9b6b8](https://github.com/eqty-dao/ownables-js/commit/aa9b6b8a6adc779089e4f7c2f4c92890b3dc25c2))
* **release:** fix rust schema generation step ([17b8a74](https://github.com/eqty-dao/ownables-js/commit/17b8a74886daf8208fd224195bef1e8efa3dca5e))

# [0.5.0](https://github.com/eqty-dao/ownables-js/compare/v0.4.0...v0.5.0) (2026-04-01)


### Features

* make builder and relay configuration explicit ([38f7ade](https://github.com/eqty-dao/ownables-js/commit/38f7ade10aa079ae0d7a873bfea2778790c40232))

# [0.4.0](https://github.com/eqty-dao/ownables-js/compare/v0.3.0...v0.4.0) (2026-03-30)


### Features

* add browser builder package and rebase ownable-static contract ([993b1e1](https://github.com/eqty-dao/ownables-js/commit/993b1e12ccde727702377cfc69859f80b376b084))

# [0.3.0](https://github.com/eqty-dao/ownables-js/compare/v0.2.0...v0.3.0) (2026-03-24)


### Features

* **core:** add consola logger adapter utility ([c860a5d](https://github.com/eqty-dao/ownables-js/commit/c860a5d6f9c830ff35e219f90a5f161ace4a6c62))

# [0.2.0](https://github.com/eqty-dao/ownables-js/compare/v0.1.0...v0.2.0) (2026-03-19)


### Features

* add ethers adapter package ([4366858](https://github.com/eqty-dao/ownables-js/commit/43668583c0be3c86df0fe903e697d3d1fdde3ba2))
* configure semantic-release with npm oidc publishing ([8cdc341](https://github.com/eqty-dao/ownables-js/commit/8cdc341de8ab874401a97154263efce27f87d77f))
* extract authority architecture into ownables-js ([82de0e9](https://github.com/eqty-dao/ownables-js/commit/82de0e9cb6cfb7c1b9769c07f3ab9fb8b68be35f))
* **notify:** add DI notify packages and deprecate relay transport ([38ab8db](https://github.com/eqty-dao/ownables-js/commit/38ab8db8523d0575201f196be47096df9b445dea))


### Reverts

* undo accidental 1.0.0 release artifacts ([22aa260](https://github.com/eqty-dao/ownables-js/commit/22aa260d9925a09e9ca8615df81878180555c9c6))

# Changelog

All notable changes to this project will be documented in this file.
