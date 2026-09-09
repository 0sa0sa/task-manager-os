import { describe, expect, it } from 'vitest';
import { SonioxSession } from '../server/soniox.js';

class FakeClient {
  readyState = 1;
  messages: unknown[] = [];
  closed = false;
  send(value: string) { this.messages.push(JSON.parse(value)); }
  close() { this.closed = true; }
}

describe('SonioxSession protocol guard', () => {
  it('rejects malformed and unsupported client commands without throwing', () => {
    const client = new FakeClient();
    const session = new SonioxSession();
    session.attach(client);

    expect(() => session.message('not-json')).not.toThrow();
    expect(() => session.message(JSON.stringify({ type: 'unknown' }))).not.toThrow();
    expect(client.messages).toEqual([
      { type: 'error', providerId: 'soniox', message: 'WebSocketメッセージが不正です' },
      { type: 'error', providerId: 'soniox', message: '未対応の音声認識コマンドです' },
    ]);
  });

  it('reports a clean error when recognition starts without a key', () => {
    const original = process.env.SONIOX_API_KEY;
    delete process.env.SONIOX_API_KEY;
    try {
      const client = new FakeClient();
      const session = new SonioxSession();
      session.attach(client);
      session.message(JSON.stringify({ type: 'start' }));
      expect(client.messages).toEqual([{ type: 'error', providerId: 'soniox', message: 'Soniox APIキーが設定されていません' }]);
    } finally {
      if (original === undefined) delete process.env.SONIOX_API_KEY;
      else process.env.SONIOX_API_KEY = original;
    }
  });

  it('ignores audio until an upstream socket is ready and stops cleanly', () => {
    const client = new FakeClient();
    const session = new SonioxSession();
    session.attach(client);
    session.message(new Uint8Array(8));
    session.message(JSON.stringify({ type: 'stop' }));
    expect(client.messages).toEqual([
      { type: 'status', status: 'stopping', message: 'Sonioxを停止しています…' },
      { type: 'status', status: 'closed', message: '音声認識を停止しました' },
    ]);
    session.close();
  });
});
