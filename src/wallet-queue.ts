/**
 * Per-wallet sequential queue — prevents nonce conflicts when multiple
 * strategies trigger at the same time on one custodial wallet.
 */

class WalletQueue {
  private queues = new Map<string, Array<() => Promise<void>>>();
  private running = new Set<string>();

  async add(walletAddress: string, task: () => Promise<void>): Promise<void> {
    return new Promise((resolve, reject) => {
      const queue = this.queues.get(walletAddress) ?? [];
      queue.push(async () => {
        try {
          await task();
          resolve();
        } catch (e) {
          reject(e);
        }
      });
      this.queues.set(walletAddress, queue);
      void this.drain(walletAddress);
    });
  }

  private async drain(walletAddress: string): Promise<void> {
    if (this.running.has(walletAddress)) return;

    const queue = this.queues.get(walletAddress) ?? [];
    if (queue.length === 0) return;

    this.running.add(walletAddress);
    const task = queue.shift()!;
    this.queues.set(walletAddress, queue);

    try {
      await task();
    } finally {
      this.running.delete(walletAddress);
      void this.drain(walletAddress);
    }
  }
}

export const walletQueue = new WalletQueue();
