import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

const DB_NAME = 'time-shards-db';
const DB_VERSION = 1;
const STORE_NAME = 'payload';
const PAYLOAD_KEY = 'main';

/**
 * IndexedDB 持久化服务，供 Time-Shards 组件使用。
 * 所有操作均为 Promise，调用方自行处理异步。
 */
@Injectable({ providedIn: 'root' })
export class TimeShardsDbService {
  private platformId = inject(PLATFORM_ID);
  private isBrowser = isPlatformBrowser(this.platformId);

  /** 单例 DB 连接 Promise，避免重复 open */
  private dbPromise: Promise<IDBDatabase> | null = null;

  private openDb(): Promise<IDBDatabase> {
    if (!this.isBrowser) {
      return Promise.reject(new Error('Not in browser environment'));
    }
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = (e) => {
        const db = (e.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };

      req.onsuccess = (e) => resolve((e.target as IDBOpenDBRequest).result);
      req.onerror = () => {
        this.dbPromise = null; // 允许重试
        reject(req.error);
      };
    });

    return this.dbPromise;
  }

  /** 将任意可序列化对象写入 IndexedDB */
  async save(data: unknown): Promise<void> {
    if (!this.isBrowser) return;
    const db = await this.openDb();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(data, PAYLOAD_KEY);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  /** 从 IndexedDB 读取数据，不存在时返回 null */
  async load(): Promise<unknown> {
    if (!this.isBrowser) return null;
    const db = await this.openDb();
    return new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(PAYLOAD_KEY);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  }
}