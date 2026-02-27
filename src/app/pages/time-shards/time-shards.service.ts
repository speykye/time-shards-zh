// time-shards.service.ts
import { Injectable } from '@angular/core';

export interface SealRequest {
  entryHash: string;
  prevHash: string;
  artifacts: string[];
  toolVersion: number;
  entryVersion: number;
}

export interface SealReceipt {
  sealedAt: string;
  prevHash: string;
  entryHash: string;
  entryVersion: number;
  toolVersion: number;
  signature: string;
}

@Injectable({
  providedIn: 'root',
})
export class TimeShardsProofService {
  // TODO: 替换为未来的后端地址
  private readonly API_BASE = ''; 

  /**
   * 将哈希上传到可信时间戳服务
   * 目前为模拟实现 / 占位符
   */
  async sealEntry(req: SealRequest): Promise<{ receipt: SealReceipt; ownerDeleteToken?: string }> {
    console.log('[ProofService] Simulating seal request:', req);
    
    if (!this.API_BASE) {
      // 模拟延迟和成功
      await new Promise(r => setTimeout(r, 600));
      return {
        receipt: {
          sealedAt: new Date().toISOString(),
          prevHash: req.prevHash,
          entryHash: req.entryHash,
          entryVersion: req.entryVersion,
          toolVersion: req.toolVersion,
          signature: 'mock-signature-' + Math.random().toString(36).slice(2),
        },
        ownerDeleteToken: 'mock-token-' + Math.random().toString(36).slice(2),
      };
    }

    // 未来真实实现：
    // const resp = await fetch(`${this.API_BASE}/seal`, { ... });
    // return resp.json();
    
    throw new Error('Proof service not configured yet.');
  }

  /**
   * 撤销封存
   */
  async revokeEntry(entryHash: string, token: string): Promise<{ ok: boolean }> {
    console.log('[ProofService] Simulating revoke request:', entryHash);
    
    if (!this.API_BASE) {
      await new Promise(r => setTimeout(r, 600));
      return { ok: true };
    }

    throw new Error('Proof service not configured yet.');
  }
}