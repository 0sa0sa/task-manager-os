import { performance } from 'node:perf_hooks';

const SONIOX_URL = 'wss://stt-rt.soniox.com/transcribe-websocket';
const MAX_AUDIO_BYTES = 64 * 1024;
const MAX_SESSION_MS = 30 * 60 * 1000;

type Client = {
  readyState: number;
  send(data: string): void;
  close(): void;
};

type SonioxToken = {
  text?: unknown;
  is_final?: unknown;
  speaker?: unknown;
  start_ms?: unknown;
  end_ms?: unknown;
};

type SonioxMessage = {
  tokens?: SonioxToken[];
  error_type?: unknown;
  error_message?: unknown;
};

type TranscriptUpdate = {
  providerId: 'soniox';
  segmentId: string;
  revision: number;
  text: string;
  textFinal: boolean;
  speakerId: string | null;
  startMs: number | null;
  endMs: number | null;
  receivedMonoMs: number;
};

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

function normalizeSpeaker(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function normalizeError(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 500) : 'unknown error';
}

export class SonioxSession {
  private client: Client | null = null;
  private upstream: WebSocket | null = null;
  private startedAt = 0;
  private segment = 0;
  private revision = 0;
  private stopped = false;
  private closingTimer: ReturnType<typeof setTimeout> | null = null;

  attach(client: Client): void {
    this.client = client;
  }

  private send(message: unknown): void {
    if (this.client?.readyState === 1) this.client.send(JSON.stringify(message));
  }

  private fail(message: string): void {
    this.send({ type: 'error', providerId: 'soniox', message });
  }

  start(): void {
    if (this.upstream || this.startedAt) return;
    const apiKey = process.env.SONIOX_API_KEY?.trim();
    if (!apiKey) {
      this.fail('Soniox APIキーが設定されていません');
      return;
    }
    this.startedAt = Date.now();
    this.stopped = false;
    this.send({ type: 'status', status: 'connecting', message: 'Sonioxへ接続しています…' });
    try {
      const upstream = new WebSocket(SONIOX_URL);
      this.upstream = upstream;
      upstream.binaryType = 'arraybuffer';
      upstream.onopen = () => {
        if (this.stopped) return;
        upstream.send(JSON.stringify({
          api_key: apiKey,
          model: 'stt-rt-v5',
          audio_format: 'pcm_s16le',
          sample_rate: 16000,
          num_channels: 1,
          language_hints: ['ja', 'en'],
          enable_speaker_diarization: true,
          enable_endpoint_detection: true,
        }));
        this.send({ type: 'status', status: 'listening', message: 'Soniox接続完了。話してください。' });
      };
      upstream.onmessage = (event) => this.handleMessage(typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data as ArrayBuffer));
      upstream.onerror = () => this.fail('Sonioxへの接続に失敗しました。APIキーとネットワークを確認してください');
      upstream.onclose = () => {
        this.upstream = null;
        if (this.closingTimer) clearTimeout(this.closingTimer);
        this.closingTimer = null;
        if (this.stopped) {
          this.send({ type: 'status', status: 'closed', message: '音声認識を停止しました' });
        } else this.send({ type: 'status', status: 'closed', message: 'Soniox接続が終了しました' });
        this.client?.close();
      };
    } catch {
      this.upstream = null;
      this.fail('Soniox接続を開始できませんでした');
    }
  }

  private handleMessage(raw: string): void {
    let message: SonioxMessage;
    try {
      message = JSON.parse(raw) as SonioxMessage;
    } catch {
      this.fail('Sonioxの応答を解釈できませんでした');
      return;
    }
    if (message.error_type || message.error_message) {
      this.fail(`Sonioxエラー: ${normalizeError(message.error_message ?? message.error_type)}`);
      return;
    }
    if (!Array.isArray(message.tokens) || !message.tokens.length) return;
    const tokens = message.tokens;
    const text = tokens.map((token) => typeof token.text === 'string' ? token.text : '').join('').replaceAll('<fin>', '').replaceAll('<end>', '');
    if (!text) return;
    const final = tokens.every((token) => token.is_final === true);
    const speakers = tokens.map((token) => normalizeSpeaker(token.speaker)).filter((speaker): speaker is string => Boolean(speaker));
    const startValues = tokens.map((token) => token.start_ms).filter(finite);
    const endValues = tokens.map((token) => token.end_ms).filter(finite);
    const update: TranscriptUpdate = {
      providerId: 'soniox',
      segmentId: `soniox-${this.segment}`,
      revision: ++this.revision,
      text,
      textFinal: final,
      speakerId: speakers.at(-1) ?? null,
      startMs: startValues.length ? Math.min(...startValues) : null,
      endMs: endValues.length ? Math.max(...endValues) : null,
      receivedMonoMs: performance.now(),
    };
    this.send({ type: 'transcript', update });
    if (final) this.segment += 1;
  }

  audio(data: ArrayBuffer | Uint8Array): void {
    if (this.stopped || !this.upstream || this.upstream.readyState !== 1) return;
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    if (!bytes.byteLength || bytes.byteLength > MAX_AUDIO_BYTES) return;
    if (Date.now() - this.startedAt > MAX_SESSION_MS) {
      this.fail('音声認識の最大時間（30分）に達しました');
      this.stop();
      return;
    }
    this.upstream.send(bytes);
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.send({ type: 'status', status: 'stopping', message: 'Sonioxを停止しています…' });
    if (this.upstream) {
      if (this.upstream.readyState === 1) {
        try { this.upstream.send(JSON.stringify({ type: 'finalize' })); } catch { /* close below */ }
      }
      this.closingTimer = setTimeout(() => this.upstream?.close(), 2500);
    } else {
      this.send({ type: 'status', status: 'closed', message: '音声認識を停止しました' });
      this.client?.close();
    }
  }

  close(): void {
    this.stopped = true;
    if (this.closingTimer) clearTimeout(this.closingTimer);
    this.closingTimer = null;
    try { this.upstream?.close(); } catch { /* already closed */ }
    this.upstream = null;
    this.client = null;
  }

  message(data: string | ArrayBuffer | Uint8Array): void {
    if (typeof data === 'string') {
      let command: unknown;
      try { command = JSON.parse(data); } catch { this.fail('WebSocketメッセージが不正です'); return; }
      if (!command || typeof command !== 'object' || Array.isArray(command)) { this.fail('WebSocketコマンドが不正です'); return; }
      const type = (command as { type?: unknown }).type;
      if (type === 'start') this.start();
      else if (type === 'stop') this.stop();
      else this.fail('未対応の音声認識コマンドです');
      return;
    }
    this.audio(data instanceof Uint8Array ? data : new Uint8Array(data));
  }
}
