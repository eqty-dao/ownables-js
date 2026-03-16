export default class SessionStorageService {
  static get(key: string, storage: Storage = sessionStorage): any {
    const value = storage.getItem(key);
    return value ? JSON.parse(value) : undefined;
  }

  static set(key: string, value: any, storage: Storage = sessionStorage): void {
    storage.setItem(key, JSON.stringify(value));
  }

  static remove(key: string, storage: Storage = sessionStorage): void {
    storage.removeItem(key);
  }

  static clear(storage: Storage = sessionStorage): void {
    storage.clear();
  }
}
