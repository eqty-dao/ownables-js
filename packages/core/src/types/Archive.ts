export interface ImportedArchive {
  cid: string;
  chainJson: Record<string, unknown>;
  chainFileName: 'eventChain.json' | 'chain.json';
  packageFiles: string[];
}

export interface ArchiveService {
  importArchive(data: Uint8Array): Promise<ImportedArchive>;
  hasPackage(cid: string): Promise<boolean>;
  hasChain(cid: string): Promise<boolean>;
  readChain(cid: string): Promise<Record<string, unknown>>;
  readPackageZip(cid: string): Promise<Uint8Array>;
}
