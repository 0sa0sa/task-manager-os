import { useEffect, useMemo, useRef, useState, type FormEvent as ReactFormEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FolderPlus,
  Mic,
  MicOff,
  Plus,
  RotateCcw,
  Send,
  Trash2,
  X,
} from "lucide-react";
import {
  COLORS,
  interpretVoice,
  progress,
  statusLabel,
  type Command,
  type ConversationSnapshot,
  type GraphLayout,
  type GraphView,
  type Project,
  type State,
  type Status,
  type Task,
} from "./domain";
import { FounderGraph } from "./FounderGraph";
import "./App.css";

type SonioxTranscriptUpdate = {
  text: string;
  textFinal: boolean;
  segmentId: string;
  speakerId: string | null;
};

function pcm16k(samples: Float32Array, sampleRate: number): ArrayBuffer {
  if (!samples.length || !Number.isFinite(sampleRate) || sampleRate <= 0) return new ArrayBuffer(0);
  const ratio = sampleRate / 16000;
  const output = new Int16Array(Math.max(1, Math.round(samples.length / ratio)));
  for (let index = 0; index < output.length; index += 1) {
    const source = index * ratio;
    const lower = Math.floor(source);
    const upper = Math.min(samples.length - 1, lower + 1);
    const amount = source - lower;
    const value = samples[lower] * (1 - amount) + samples[upper] * amount;
    output[index] = Math.max(-1, Math.min(1, value)) * 0x7fff;
  }
  return output.buffer;
}

function VoiceBar({
  state,
  projectId,
  taskId,
  busy,
  onRun,
}: {
  state: State;
  projectId: string | null;
  taskId: string | null;
  busy: boolean;
  onRun: (command: Command) => Promise<void>;
}) {
  const [draft, setDraft] = useState("");
  const [interim, setInterim] = useState("");
  const [listening, setListening] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState("Soniox待機中");
  const [voiceError, setVoiceError] = useState("");
  const socketRef = useRef<WebSocket | null>(null);
  const startingRef = useRef(false);
  const finalizedSegmentsRef = useRef(new Set<string>());
  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const interpretation = useMemo(
    () => interpretVoice(draft, state, projectId, taskId),
    [draft, state, projectId, taskId],
  );
  const supported =
    typeof window !== "undefined" &&
    !!window.WebSocket &&
    !!navigator.mediaDevices?.getUserMedia &&
    !!(window.AudioContext || (window as any).webkitAudioContext);
  const cleanupAudio = () => {
    processorRef.current?.disconnect();
    processorRef.current = null;
    void contextRef.current?.close();
    contextRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };
  const stopCapture = () => {
    const socket = socketRef.current;
    setListening(false);
    setInterim("");
    cleanupAudio();
    if (!socket) {
      setVoiceStatus("Soniox待機中");
      return;
    }
    if (socket.readyState === WebSocket.OPEN) {
      try { socket.send(JSON.stringify({ type: "stop" })); } catch { /* close below */ }
      setVoiceStatus("停止処理中…");
      if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
      stopTimerRef.current = setTimeout(() => socket.close(), 2500);
    } else {
      socket.close();
    }
  };
  const startCapture = async () => {
    if (!supported || listening || startingRef.current) return;
    startingRef.current = true;
    setVoiceError("");
    finalizedSegmentsRef.current.clear();
    setVoiceStatus("マイクを準備しています…");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      streamRef.current = stream;
      const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextCtor) throw new Error("AudioContext unavailable");
      const context = new AudioContextCtor() as AudioContext;
      contextRef.current = context;
      await context.resume();
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(4096, 1, 1);
      const silence = context.createGain();
      silence.gain.value = 0;
      processor.onaudioprocess = (event) => {
        const socket = socketRef.current;
        if (!socket || socket.readyState !== WebSocket.OPEN) return;
        const bytes = pcm16k(event.inputBuffer.getChannelData(0), context.sampleRate);
        if (bytes.byteLength > 64 * 1024) return;
        socket.send(bytes);
      };
      source.connect(processor);
      processor.connect(silence);
      silence.connect(context.destination);
      processorRef.current = processor;
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(`${protocol}//${window.location.host}/api/soniox`);
      socket.binaryType = "arraybuffer";
      socketRef.current = socket;
      socket.onopen = () => {
        socket.send(JSON.stringify({ type: "start" }));
        setListening(true);
        startingRef.current = false;
        setVoiceStatus("Sonioxへ接続中…");
      };
      socket.onmessage = (event) => {
        let message: { type?: string; message?: string; update?: SonioxTranscriptUpdate };
        try { message = JSON.parse(String(event.data)) as typeof message; } catch { setVoiceError("音声認識サーバーの応答を解釈できませんでした"); return; }
        if (message.type === "status") setVoiceStatus(message.message || "Soniox接続中…");
        if (message.type === "error") {
          setVoiceError(message.message || "Sonioxで音声認識できませんでした");
          setListening(false);
          startingRef.current = false;
          cleanupAudio();
          socket.close();
        }
        const update = message.update;
        if (message.type === "transcript" && update?.text) {
          if (update.textFinal) {
            if (!finalizedSegmentsRef.current.has(update.segmentId)) {
              finalizedSegmentsRef.current.add(update.segmentId);
              setDraft((current) => current ? `${current} ${update.text}` : update.text);
            }
            setInterim("");
          } else setInterim(update.text);
        }
      };
      socket.onerror = () => {
        setVoiceError("Sonioxへ接続できません。APIキー・契約・ネットワークを確認してください");
        setListening(false);
        startingRef.current = false;
        cleanupAudio();
        socket.close();
      };
      socket.onclose = () => {
        if (socketRef.current === socket) socketRef.current = null;
        startingRef.current = false;
        if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
        stopTimerRef.current = null;
        cleanupAudio();
        setListening(false);
        setVoiceStatus("Soniox待機中");
      };
    } catch {
      cleanupAudio();
      setListening(false);
      startingRef.current = false;
      setVoiceStatus("Soniox待機中");
      setVoiceError("マイクを利用できません。ブラウザーの権限とHTTPS接続を確認してください");
    }
  };
  useEffect(() => () => {
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    cleanupAudio();
    socketRef.current?.close();
  }, []);
  const toggle = () => { if (listening) stopCapture(); else void startCapture(); };
  const run = async () => {
    if (interpretation.kind !== "ready") return;
    if (
      interpretation.destructive &&
      !window.confirm(`${interpretation.summary}しますか？`)
    )
      return;
    await onRun(interpretation.command);
    setDraft("");
    setInterim("");
  };
  return (
    <section className={`voice-bar${listening ? " listening" : ""}`}>
      <button
        className="mic"
        type="button"
        onClick={toggle}
        disabled={!supported}
        aria-label={listening ? "音声入力を停止" : "音声入力を開始"}
      >
        {listening ? <MicOff size={19} /> : <Mic size={19} />}
        <span>{listening ? "LISTENING" : "SONIOX"}</span>
      </button>
      <div className="voice-input">
        <span>›</span>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void run();
          }}
          placeholder={
            supported
              ? "話すか入力してください…"
              : "コマンドを入力してください…"
          }
          aria-label="コマンド入力"
        />
        {interim && <em>{interim}</em>}
        <small className="voice-status">{voiceStatus}</small>
        <small className={`interpretation ${interpretation.kind}`}>
          {draft
            ? interpretation.kind === "ready"
              ? `✓ ${interpretation.summary}`
              : interpretation.message
            : "例: Task Manager OSにタスク テストを追加"}
        </small>
      </div>
      <button
        className="run"
        type="button"
        onClick={() => void run()}
        disabled={busy || interpretation.kind !== "ready"}
      >
        <Send size={16} />
        実行
      </button>
      <button
        className="undo"
        type="button"
        disabled={busy || !state.undo}
        onClick={() => void onRun({ type: "undo" })}
        aria-label="直前の操作を戻す"
      >
        <RotateCcw size={17} />
      </button>
      {voiceError && <span className="voice-error">{voiceError}</span>}
    </section>
  );
}

function ViewSwitcher({ layout, onChange }: { layout: GraphLayout; onChange: (layout: GraphLayout) => void }) {
  const views: GraphView[] = layout.views?.length ? layout.views : [{ id: "default", name: "Default", hidden: layout.hidden }];
  const activeId = layout.activeViewId && views.some(view => view.id === layout.activeViewId) ? layout.activeViewId : views[0].id;
  const active = views.find(view => view.id === activeId) ?? views[0];
  const select = (id: string) => { const next = views.find(view => view.id === id) ?? views[0]; onChange({ ...layout, views, activeViewId: next.id, hidden: next.hidden }); };
  const create = () => { const name = window.prompt("新しいビュー名", `View ${views.length + 1}`)?.trim(); if (!name) return; const id = `view-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`; const next = [...views, { id, name: name.slice(0, 80), hidden: [...active.hidden] }]; onChange({ ...layout, views: next, activeViewId: id, hidden: [...active.hidden] }); };
  const rename = () => { const name = window.prompt("ビュー名を変更", active.name)?.trim(); if (!name || name === active.name) return; onChange({ ...layout, views: views.map(view => view.id === active.id ? { ...view, name: name.slice(0, 80) } : view), activeViewId: active.id, hidden: active.hidden }); };
  const remove = () => { if (views.length <= 1 || !window.confirm(`ビュー「${active.name}」を削除しますか？`)) return; const next = views.filter(view => view.id !== active.id); const selected = next[0]; onChange({ ...layout, views: next, activeViewId: selected.id, hidden: selected.hidden }); };
  return <div className="view-switcher" aria-label="ビュー切替"><span>VIEW</span><select value={active.id} onChange={event => select(event.target.value)} aria-label="表示ビュー">{views.map(view => <option value={view.id} key={view.id}>{view.name} · {view.hidden.length ? `${view.hidden.length} hidden` : "all"}</option>)}</select><button onClick={create} title="ビューを作成">＋</button><button onClick={rename} title="ビュー名を変更">名前変更</button><button onClick={remove} title="ビューを削除" disabled={views.length <= 1}>削除</button></div>;
}

function Detail({
  state,
  project,
  task,
  busy: _busy,
  execute,
  selectProject,
  selectTask,
  onHerdrState,
}: {
  state: State;
  project: Project | null;
  task: Task | null;
  busy: boolean;
  execute: (c: Command) => Promise<void>;
  selectProject: (id: string | null) => void;
  selectTask: (id: string | null) => void;
  onHerdrState: (state: State) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newSub, setNewSub] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspaceCwd, setWorkspaceCwd] = useState("");
  const [herdrAgent, setHerdrAgent] = useState<"claude" | "codex">("codex");
  const [herdrBusy, setHerdrBusy] = useState(false);
  const [herdrError, setHerdrError] = useState("");
  const [conversation, setConversation] = useState<ConversationSnapshot | null>(null);
  const [conversationBusy, setConversationBusy] = useState(false);
  const [conversationError, setConversationError] = useState("");
  const [reply, setReply] = useState("");
  useEffect(() => {
    setName(task?.title ?? project?.name ?? "");
    setDescription(task?.description ?? "");
  }, [task?.id, task?.title, task?.description, project?.id, project?.name]);
  useEffect(() => {
    let cancelled = false;
    setConversation(null);
    setConversationError("");
    setReply("");
    setConversationBusy(false);
    if (!task?.paneId || (task.agent !== "claude" && task.agent !== "codex")) return;
    setConversationBusy(true);
    fetch(`/api/conversations/${encodeURIComponent(task.id)}`)
      .then(async (response) => { const body = await response.json(); if (!response.ok || !body.ok) throw new Error(body.error); return body.conversation as ConversationSnapshot; })
      .then((next) => { if (!cancelled) setConversation(next); })
      .catch((error) => { if (!cancelled) setConversationError(error instanceof Error ? error.message : "会話を読み込めませんでした"); })
      .finally(() => { if (!cancelled) setConversationBusy(false); });
    return () => { cancelled = true; };
  }, [task?.id, task?.paneId, task?.agent]);
  const resumeConversation = async () => {
    if (!task?.paneId || !reply.trim() || conversationBusy) return;
    setConversationBusy(true);
    setConversationError("");
    try {
      const response = await fetch(`/api/conversations/${encodeURIComponent(task.id)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: reply }) });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error);
      setConversation(body.conversation as ConversationSnapshot);
      setReply("");
    } catch (error) { setConversationError(error instanceof Error ? error.message : "会話を再開できませんでした"); }
    finally { setConversationBusy(false); }
  };
  const refreshConversation = async () => {
    if (!task?.paneId || conversationBusy) return;
    setConversationBusy(true);
    setConversationError("");
    try {
      const response = await fetch(`/api/conversations/${encodeURIComponent(task.id)}`);
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error);
      setConversation(body.conversation as ConversationSnapshot);
    } catch (error) { setConversationError(error instanceof Error ? error.message : "会話を更新できませんでした"); }
    finally { setConversationBusy(false); }
  };
  const createHerdrWorkspace = async (event: ReactFormEvent) => {
    event.preventDefault();
    if (!workspaceName.trim() || herdrBusy) return;
    setHerdrBusy(true); setHerdrError("");
    try {
      const response = await fetch("/api/herdr/workspaces", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ label: workspaceName, cwd: workspaceCwd }) });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error);
      onHerdrState(body.state as State); setWorkspaceName(""); setWorkspaceCwd("");
    } catch (error) { setHerdrError(error instanceof Error ? error.message : "Herdr workspaceを作成できませんでした"); }
    finally { setHerdrBusy(false); }
  };
  const startHerdrAgent = async () => {
    if (!project?.workspaceId || !newTitle.trim() || herdrBusy) return;
    setHerdrBusy(true); setHerdrError("");
    try {
      const response = await fetch("/api/herdr/agents", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: project.id, title: newTitle, agent: herdrAgent }) });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error);
      onHerdrState(body.state as State); setNewTitle("");
    } catch (error) { setHerdrError(error instanceof Error ? error.message : "agent paneを開始できませんでした"); }
    finally { setHerdrBusy(false); }
  };
  if (!project)
    return (
      <aside className="details">
        <header>
          <small>PROJECT INDEX</small>
          <h2>Workspaces</h2>
          <p>{state.projects.length} active orbits</p>
        </header>
        <div className="index-list">
          {state.projects.map((p, i) => (
            <button key={p.id} onClick={() => selectProject(p.id)}>
              <i style={{ background: p.color }} />
              <span>
                <small>{String(i + 1).padStart(2, "0")}</small>
                {p.name}
              </span>
              <b>{Math.round(progress(p) * 100)}%</b>
            </button>
          ))}
        </div>
        <form
          className="create-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (newTitle.trim()) {
              void execute({
                type: "project.create",
                name: newTitle,
                color: COLORS[state.projects.length % COLORS.length],
              });
              setNewTitle("");
            }
          }}
        >
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="新しいプロジェクト"
            maxLength={120}
          />
          <button>
            <FolderPlus size={16} />
            作成
          </button>
        </form>
        <section className="herdr-create-card">
          <div className="herdr-card-title">HERDR WORKSPACE</div>
          <p>新しいプロジェクトをHerdr workspaceとして作成します。</p>
          <form onSubmit={createHerdrWorkspace}>
            <input value={workspaceName} onChange={(e) => setWorkspaceName(e.target.value)} placeholder="workspace名" maxLength={120} />
            <input value={workspaceCwd} onChange={(e) => setWorkspaceCwd(e.target.value)} placeholder="作業ディレクトリ（空欄=現在の場所）" />
            <button disabled={herdrBusy || !workspaceName.trim()}>{herdrBusy ? "作成中…" : "Herdr workspace作成"}</button>
          </form>
          {herdrError && <small className="herdr-error">{herdrError}</small>}
        </section>
      </aside>
    );
  if (!task)
    return (
      <aside className="details">
        <button className="back" onClick={() => selectProject(null)}>
          ← 全プロジェクト
        </button>
        <header>
          <small>
            PROJECT / {project.tasks.length.toString().padStart(2, "0")}
          </small>
          <h2>{project.name}</h2>
          <div className="progress">
            <span
              style={{
                width: `${progress(project) * 100}%`,
                background: project.color,
              }}
            />
          </div>
          <p>{Math.round(progress(project) * 100)}% complete</p>
        </header>
        <form
          className="create-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (newTitle.trim()) {
              void execute({
                type: "task.create",
                projectId: project.id,
                title: newTitle,
              });
              setNewTitle("");
            }
          }}
        >
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="新しいタスク"
            maxLength={120}
          />
          <button>
            <Plus size={16} />
            追加
          </button>
        </form>
        <div className="herdr-task-card">
          <div className="herdr-card-title">START IN HERDR</div>
          <div className="herdr-task-controls">
            <select value={herdrAgent} onChange={(e) => setHerdrAgent(e.target.value as "claude" | "codex")} aria-label="起動するagent"><option value="codex">Codex</option><option value="claude">Claude Code</option></select>
            <button type="button" onClick={() => void startHerdrAgent()} disabled={herdrBusy || !project.workspaceId || !newTitle.trim()}>{herdrBusy ? "起動中…" : "paneを開始"}</button>
          </div>
          <small>{project.workspaceId ? "タスク名を入力してagent paneを追加" : "Herdr workspaceに紐づくプロジェクトで利用できます"}</small>
          {herdrError && <small className="herdr-error">{herdrError}</small>}
        </div>
        <div className="task-list">
          {project.tasks.map((t) => (
            <button
              className="task-row"
              key={t.id}
              onClick={() => selectTask(t.id)}
            >
              <i className={`status-dot ${t.status}`} />
              <span>
                {t.title}
                <small>
                  {statusLabel(t.status)} · {t.subtasks.length} subtasks
                </small>
              </span>
              <ArrowRight size={15} />
            </button>
          ))}
          {!project.tasks.length && (
            <p className="hint">タスクを追加するとここに表示されます。</p>
          )}
        </div>
        <button
          className="danger"
          onClick={() => {
            if (window.confirm("プロジェクトと全タスクを削除しますか？")) {
              void execute({ type: "project.delete", projectId: project.id });
              selectProject(null);
            }
          }}
        >
          <Trash2 size={14} />
          プロジェクトを削除
        </button>
      </aside>
    );
  const cycle = (s: Status): Status =>
    s === "todo" ? "doing" : s === "doing" ? "done" : "todo";
  return (
    <aside className="details">
      <button className="back" onClick={() => selectTask(null)}>
        ← {project.name}
      </button>
      <header>
        <small>TASK / {task.id.slice(0, 8).toUpperCase()}</small>
        <input
          className="title"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() =>
            name.trim() &&
            void execute({
              type: "task.rename",
              projectId: project.id,
              taskId: task.id,
              title: name,
            })
          }
        />
        <div className="status-pills">
          {(["todo", "doing", "done"] as Status[]).map((s) => (
            <button
              key={s}
              className={task.status === s ? "active" : ""}
              onClick={() =>
                void execute({
                  type: "task.status",
                  projectId: project.id,
                  taskId: task.id,
                  status: s,
                })
              }
            >
              {statusLabel(s)}
            </button>
          ))}
        </div>
      </header>
      <label className="description">
        <span>MEMO</span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() =>
            void execute({
              type: "task.describe",
              projectId: project.id,
              taskId: task.id,
              description,
            })
          }
          placeholder="背景、完了条件、次の一手…"
          maxLength={2000}
        />
      </label>
      {task.paneId && (task.agent === "claude" || task.agent === "codex") && (
        <section className="conversation-panel" aria-label="Agent conversation">
          <div className="conversation-heading">
            <span>RECENT {task.agent === "claude" ? "CLAUDE CODE" : "CODEX"} EXCHANGE</span>
            <span className="conversation-controls"><small>{task.paneId} · {conversation?.status ?? task.agentStatus ?? "unknown"}</small><button onClick={() => void refreshConversation()} disabled={conversationBusy}>更新</button></span>
          </div>
          {conversationBusy && !conversation && <p className="conversation-muted">直近のやりとりを読み込んでいます…</p>}
          {conversation?.summary && <p className="conversation-summary">{conversation.summary}</p>}
          {conversation?.messages.length ? (
            <div className="conversation-messages">
              {conversation.messages.slice(-6).map((message, index) => <div className={`conversation-message ${message.role}`} key={`${message.role}-${index}`}><b>{message.role === "user" ? "YOU" : message.role === "assistant" ? (task.agent === "claude" ? "CLAUDE" : "CODEX") : "SYSTEM"}</b><p>{message.text}</p></div>)}
            </div>
          ) : conversation?.excerpt ? <pre className="conversation-excerpt">{conversation.excerpt}</pre> : null}
          {conversationError && <p className="conversation-error">{conversationError}</p>}
          <div className="conversation-compose">
            <textarea value={reply} onChange={(e) => setReply(e.target.value)} placeholder="このpaneで会話を再開…" maxLength={4000} disabled={conversationBusy} />
            <button onClick={() => void resumeConversation()} disabled={conversationBusy || !reply.trim()}>{conversationBusy ? "送信中…" : "会話を再開"}</button>
          </div>
        </section>
      )}
      <div className="sub-heading">
        <span>SUBTASKS</span>
        <b>
          {task.subtasks.filter((x) => x.status === "done").length}/
          {task.subtasks.length}
        </b>
      </div>
      <form
        className="create-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (newSub.trim()) {
            void execute({
              type: "subtask.create",
              projectId: project.id,
              taskId: task.id,
              title: newSub,
            });
            setNewSub("");
          }
        }}
      >
        <input
          value={newSub}
          onChange={(e) => setNewSub(e.target.value)}
          placeholder="サブタスクを追加"
          maxLength={120}
        />
        <button>
          <Plus size={16} />
          追加
        </button>
      </form>
      <div className="sub-list">
        {task.subtasks.map((s) => (
          <div className="sub-row" key={s.id}>
            <button
              className={`check ${s.status}`}
              onClick={() =>
                void execute({
                  type: "subtask.status",
                  projectId: project.id,
                  taskId: task.id,
                  subtaskId: s.id,
                  status: cycle(s.status),
                })
              }
            >
              {s.status === "done" && <Check size={13} />}
            </button>
            <span>{s.title}</span>
            <button
              className="icon"
              onClick={() => {
                if (window.confirm("サブタスクを削除しますか？"))
                  void execute({
                    type: "subtask.delete",
                    projectId: project.id,
                    taskId: task.id,
                    subtaskId: s.id,
                  });
              }}
              aria-label="削除"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
      <button
        className="danger"
        onClick={() => {
          if (window.confirm("タスクを削除しますか？")) {
            void execute({
              type: "task.delete",
              projectId: project.id,
              taskId: task.id,
            });
            selectTask(null);
          }
        }}
      >
        <Trash2 size={14} />
        タスクを削除
      </button>
    </aside>
  );
}

export default function App() {
  const [state, setState] = useState<State | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [filterProjectId, setFilterProjectId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const syncHerdr = async () => {
    try {
      const r = await fetch("/api/herdr/sync", { method: "POST" });
      const b = await r.json();
      if (!r.ok || !b.ok) throw new Error(b.error);
      setState(b.state);
    } catch {
      setError(
        "Herdrに接続できませんでした。現在の保存データを表示しています。",
      );
    }
  };
  const load = async () => {
    try {
      const r = await fetch("/api/state");
      const b = await r.json();
      if (!r.ok || !b.ok) throw new Error(b.error);
      setState(b.state);
      void syncHerdr();
    } catch {
      setError("APIに接続できません。bun run dev で起動してください。");
    }
  };
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    if (state && projectId && !state.projects.some((p) => p.id === projectId)) {
      setProjectId(null);
      setTaskId(null);
    }
    if (state && filterProjectId && !state.projects.some((p) => p.id === filterProjectId)) {
      setFilterProjectId(null);
    }
  }, [state, projectId, filterProjectId]);
  const execute = async (command: Command) => {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/commands", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(command),
      });
      const b = await r.json();
      if (!r.ok || !b.ok) throw new Error(b.error);
      setState(b.state);
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作に失敗しました");
    } finally {
      setBusy(false);
    }
  };
  const saveLayout = async (layout: GraphLayout) => {
    setState((current) => current ? { ...current, layout } : current);
    try {
      const r = await fetch("/api/layout", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(layout) });
      const b = await r.json();
      if (!r.ok || !b.ok) throw new Error(b.error);
      setState(b.state);
    } catch (e) {
      setError(e instanceof Error ? e.message : "グラフ設定を保存できませんでした");
    }
  };
  if (!state)
    return (
      <main className="loading">
        <div className="loader" />
        <p>WORKSPACEを読み込んでいます…</p>
        {error && <span>{error}</span>}
      </main>
    );
  const project = state.projects.find((p) => p.id === projectId) ?? null;
  const layout = state.layout ?? { positions: {}, hidden: [], views: [{ id: "default", name: "Default", hidden: [] }], activeViewId: "default" };
  const task =
    project?.tasks.find((t) => t.id === taskId) ??
    project?.tasks.find((t) => t.subtasks.some((s) => s.id === taskId)) ??
    null;
  const selectedWorkId = task?.id ?? null;
  const total = state.projects.reduce(
    (n, p) =>
      n + p.tasks.length + p.tasks.reduce((m, t) => m + t.subtasks.length, 0),
    0,
  );
  const done = state.projects.reduce(
    (n, p) =>
      n +
      p.tasks.filter((t) => t.status === "done").length +
      p.tasks.reduce(
        (m, t) => m + t.subtasks.filter((s) => s.status === "done").length,
        0,
      ),
    0,
  );
  return (
    <main className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">◎</span>
          <div>
            <strong>TASK MANAGER OS</strong>
            <small>ORBITAL COMMAND DESK</small>
          </div>
        </div>
        <div className="top-stats">
          <span>
            <b>{state.projects.length}</b> PROJECTS
          </span>
          <span>
            <b>{total}</b> WORK ITEMS
          </span>
          <span>
            <b>{total ? Math.round((done / total) * 100) : 0}%</b> COMPLETE
          </span>
        </div>
        <button
          className="runtime runtime-button"
          onClick={() => void syncHerdr()}
          title="Herdrのworkspaceとagent paneを再読込"
        >
          ↻ HERDR SYNC
        </button>
      </header>
      <div className="content">
        <section className="map-column">
          <div className="section-top">
            <div>
              <small>LIVE WORKSPACE / {project ? "FOCUS" : "OVERVIEW"}</small>
              <h1>{project?.name ?? "All projects"}</h1>
            </div>
            <div className="nav-buttons">
              <button
                onClick={() => {
                  const i = state.projects.findIndex((p) => p.id === projectId);
                  if (i >= 0) {
                    setFilterProjectId(null);
                    setProjectId(
                      state.projects[
                        (i - 1 + state.projects.length) % state.projects.length
                      ].id,
                    );
                    setTaskId(null);
                  }
                }}
                aria-label="前のプロジェクト"
              >
                <ArrowLeft size={15} />
              </button>
              <button
                onClick={() => {
                  const i = state.projects.findIndex((p) => p.id === projectId);
                  if (i >= 0) {
                    setFilterProjectId(null);
                    setProjectId(
                      state.projects[(i + 1) % state.projects.length].id,
                    );
                    setTaskId(null);
                  }
                }}
                aria-label="次のプロジェクト"
              >
                <ArrowRight size={15} />
              </button>
              <button
                onClick={() => {
                  setProjectId(null);
                  setTaskId(null);
                  setFilterProjectId(null);
                }}
              >
                全体
              </button>
            </div>
          </div>
          <ViewSwitcher layout={layout} onChange={(next) => void saveLayout(next)} />
          <FounderGraph
            state={state}
            layout={layout}
            projectId={projectId}
            taskId={taskId}
            filterProjectId={filterProjectId}
            onProject={(id) => {
              setProjectId(id);
              setTaskId(null);
              if (!id) setFilterProjectId(null);
            }}
            onTask={(id) => setTaskId(id)}
            onFilterProject={setFilterProjectId}
            onLayoutChange={(next) => void saveLayout(next)}
          />
          <div className="legend">
            <span>
              <i className="legend-dot todo" />
              To do
            </span>
            <span>
              <i className="legend-dot doing" />
              In progress
            </span>
            <span>
              <i className="legend-dot done" />
              Done
            </span>
            <em>right-click → 絞り込み · ← → navigate · Esc back</em>
          </div>
        </section>
        <Detail
          state={state}
          project={project}
          task={task}
          busy={busy}
          execute={execute}
          selectProject={(id) => {
            setProjectId(id);
            setTaskId(null);
            setFilterProjectId(null);
          }}
          selectTask={(id) => setTaskId(id)}
          onHerdrState={(next) => setState(next)}
        />
      </div>
      <VoiceBar
        state={state}
        projectId={projectId}
        taskId={selectedWorkId}
        busy={busy}
        onRun={execute}
      />
      {error && (
        <div className="toast">
          <span>{error}</span>
          <button onClick={() => setError("")} aria-label="エラーを閉じる">
            <X size={15} />
          </button>
        </div>
      )}
    </main>
  );
}
