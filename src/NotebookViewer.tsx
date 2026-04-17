import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FolderOpenIcon, CircleIcon, WarningIcon,
  PlayIcon, SquareIcon, ArrowClockwiseIcon,
} from '@phosphor-icons/react';
import NotebookCell, { inferLanguage, joinSource } from './NotebookCell';
import type { Notebook, NotebookCellData, CellState } from './NotebookCell';
import type { NotebookOutput } from './CellOutput';
import type { KernelService } from './plugin-types';

function isElectron() { return !!(window as { electronAPI?: unknown }).electronAPI; }

function normalizeV3Cell(cell: Record<string, unknown>): NotebookCellData {
  return {
    ...cell,
    cell_type: cell.cell_type as NotebookCellData['cell_type'],
    source: (cell.source ?? cell.input ?? []) as string | string[],
    execution_count: (cell.execution_count ?? cell.prompt_number ?? null) as number | null,
  };
}

function parseNotebook(content: string): Notebook {
  const notebook = JSON.parse(content);
  if (notebook.nbformat === 3) {
    const worksheets = notebook.worksheets as Array<{ cells?: Record<string, unknown>[] }> | undefined;
    const cells = (worksheets?.[0]?.cells ?? []).map(normalizeV3Cell);
    return { ...notebook, cells, nbformat: 4 };
  }
  return notebook as Notebook;
}

interface KernelMessage {
  header: { msg_type: string; msg_id?: string };
  parent_header: { msg_id?: string };
  content: Record<string, unknown>;
}

function msgToOutput(msgType: string, content: Record<string, unknown>): NotebookOutput | null {
  if (msgType === 'stream') return { output_type: 'stream', name: content.name as string, text: content.text as string };
  if (msgType === 'display_data') return { output_type: 'display_data', data: content.data as Record<string, string | string[]>, metadata: (content.metadata ?? {}) as Record<string, unknown> };
  if (msgType === 'execute_result') return { output_type: 'execute_result', data: content.data as Record<string, string | string[]>, metadata: (content.metadata ?? {}) as Record<string, unknown>, execution_count: content.execution_count as number };
  if (msgType === 'error') return { output_type: 'error', ename: content.ename as string, evalue: content.evalue as string, traceback: content.traceback as string[] };
  return null;
}

type KernelStatusValue = 'idle' | 'busy' | 'starting' | 'dead' | 'disconnected';

function KernelStatusDot({ status }: { status: KernelStatusValue }) {
  const colors: Record<KernelStatusValue, string> = { idle: 'text-success', busy: 'text-warning', starting: 'text-accent', dead: 'text-error', disconnected: 'text-text-tertiary' };
  return (
    <span className={`flex items-center gap-1 text-xs ${colors[status] ?? 'text-text-tertiary'}`}>
      <CircleIcon size={8} weight="fill" />{status}
    </span>
  );
}

interface VenvSelectorProps { venvPath: string | null; onSelect: (p: string) => void; validating: boolean; invalid: boolean }
function VenvSelector({ venvPath, onSelect, validating, invalid }: VenvSelectorProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const handleBrowse = useCallback(async () => {
    if (isElectron()) {
      const r = await (window as { electronAPI: { openFolderDialog: () => Promise<string | null> } }).electronAPI.openFolderDialog();
      if (r) onSelect(r);
    } else inputRef.current?.focus();
  }, [onSelect]);
  return (
    <div className="flex items-center gap-2">
      <input ref={inputRef} type="text" defaultValue={venvPath ?? ''} placeholder="/path/to/.venv"
        onKeyDown={(e) => { if (e.key === 'Enter') onSelect(e.currentTarget.value.trim()); }}
        className="h-6 px-2 text-xs bg-bg-base border border-border rounded text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent w-48" />
      <button onClick={handleBrowse} className="flex items-center gap-1 h-6 px-2 text-xs bg-bg-elevated border border-border rounded text-text-secondary hover:text-text-primary transition-colors">
        <FolderOpenIcon size={12} />Browse
      </button>
      {validating && <span className="text-text-tertiary text-xs">Validating...</span>}
      {invalid && <span className="flex items-center gap-1 text-xs text-warning"><WarningIcon size={12} />jupyter not found</span>}
    </div>
  );
}

interface PendingEntry { cellIndex: number; resolve: () => void }
type CellStatesMap = Record<number, CellState>;

interface NotebookViewerProps {
  tab: { path: string };
  activeFile: { name: string; content: string | unknown | null };
  showToast: (message: string, type: 'error' | 'warning' | 'success' | 'info') => void;
  kernelService: KernelService;
}

const NotebookViewer = ({ tab, activeFile, showToast, kernelService }: NotebookViewerProps) => {
  const filePath = tab.path;
  const fileName = activeFile.name;
  const content = activeFile.content;

  const { notebook, error } = useMemo<{ notebook: Notebook | null; error: string | null }>(() => {
    if (!content || (typeof content === 'string' && !content.trim())) return { notebook: { cells: [] }, error: null };
    try { return { notebook: parseNotebook(typeof content === 'string' ? content : JSON.stringify(content)), error: null }; }
    catch (err) { return { notebook: null, error: (err as Error).message }; }
  }, [content]);

  useEffect(() => { if (error) showToast(error, 'error'); }, [error, showToast]);

  const [venvPath, setVenvPath] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const [venvInvalid, setVenvInvalid] = useState(false);
  const [venvReady, setVenvReady] = useState(false);

  useEffect(() => {
    kernelService.getVenvPath().then((saved) => { if (saved) setVenvPath(saved as string); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSelectVenv = useCallback(async (path: string) => {
    if (!path) return;
    setValidating(true); setVenvInvalid(false); setVenvReady(false);
    try {
      const result = await kernelService.validateVenv(path);
      if (result?.valid) { await kernelService.setVenvPath(path); setVenvPath(path); setVenvReady(true); showToast('Environment ready', 'success'); }
      else { setVenvInvalid(true); setVenvPath(path); showToast(result?.error ?? 'jupyter not found', 'error'); }
    } catch (err) { setVenvInvalid(true); showToast((err as Error).message, 'error'); }
    finally { setValidating(false); }
  }, [kernelService, showToast]);

  useEffect(() => {
    if (!venvPath || venvReady) return;
    kernelService.validateVenv(venvPath).then((r) => { if (r?.valid) setVenvReady(true); else setVenvInvalid(true); }).catch(() => setVenvInvalid(true));
  }, [venvPath, venvReady, kernelService]);

  const [kernelId, setKernelId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [kernelStatus, setKernelStatus] = useState<KernelStatusValue>('disconnected');
  const [kernelStarting, setKernelStarting] = useState(false);
  const [cellStates, setCellStates] = useState<CellStatesMap>({});
  const wsRef = useRef<WebSocket | null>(null);
  const pendingRef = useRef<Map<string, PendingEntry>>(new Map());
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectCountRef = useRef<number>(0);
  const handleMsgRef = useRef<((msg: KernelMessage) => void) | null>(null);

  handleMsgRef.current = (msg: KernelMessage) => {
    const msgType = msg.header?.msg_type;
    const content = msg.content ?? {};
    const parentMsgId = msg.parent_header?.msg_id;
    if (msgType === 'status') { setKernelStatus(content.execution_state as KernelStatusValue); return; }
    if (msgType === 'execute_input') return;
    if (!parentMsgId) return;
    const entry = pendingRef.current.get(parentMsgId);
    if (!entry) return;
    if (msgType === 'execute_reply') {
      setCellStates(prev => ({ ...prev, [entry.cellIndex]: { ...prev[entry.cellIndex], running: false, executionCount: content.execution_count as number } }));
      pendingRef.current.delete(parentMsgId); entry.resolve(); return;
    }
    const output = msgToOutput(msgType, content);
    if (output) setCellStates(prev => ({ ...prev, [entry.cellIndex]: { ...prev[entry.cellIndex], outputs: [...(prev[entry.cellIndex]?.outputs ?? []), output] } }));
  };

  useEffect(() => {
    if (!venvReady || !filePath || !venvPath) return;
    let cancelled = false;
    const workspaceRoot = filePath.includes('/') ? filePath.split('/').slice(0, -1).join('/') || '/' : '.';
    async function startKernel() {
      setKernelStarting(true);
      try {
        await kernelService.startServer(venvPath!, workspaceRoot);
        if (cancelled) return;
        const session = await kernelService.createSession(filePath);
        if (cancelled) return;
        setSessionId(session.id); setKernelId(session.kernel.id);
      } catch (err) { if (!cancelled) showToast('Failed to start kernel: ' + (err as Error).message, 'error'); }
      finally { if (!cancelled) setKernelStarting(false); }
    }
    startKernel();
    return () => { cancelled = true; };
  }, [venvReady, filePath, venvPath, kernelService, showToast]);

  useEffect(() => {
    if (!kernelId) return;
    let active = true;
    let ws: WebSocket;
    async function connect() {
      setKernelStatus('starting');
      try {
        const url = await kernelService.getChannelUrl(kernelId!);
        if (!active) return;
        ws = new WebSocket(url);
        wsRef.current = ws;
        ws.onopen = () => { if (active) reconnectCountRef.current = 0; };
        ws.onmessage = (e: MessageEvent) => { if (active) try { handleMsgRef.current?.(JSON.parse(e.data as string)); } catch (_) {} };
        ws.onclose = () => {
          if (!active) return;
          wsRef.current = null; setKernelStatus('disconnected');
          const delay = Math.min(1000 * 2 ** reconnectCountRef.current, 30000);
          reconnectCountRef.current++;
          reconnectTimerRef.current = setTimeout(connect, delay);
        };
        ws.onerror = () => {};
      } catch (err) { if (active) showToast('Kernel connection failed: ' + (err as Error).message, 'error'); }
    }
    connect();
    return () => {
      active = false;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) { wsRef.current.onclose = null; wsRef.current.close(); wsRef.current = null; }
      setKernelStatus('disconnected');
    };
  }, [kernelId, kernelService, showToast]);

  useEffect(() => () => { kernelService.stopServer().catch(() => {}); }, [kernelService]);

  const runCell = useCallback((cellIndex: number, source: string): Promise<void> => {
    return new Promise<void>((resolve, reject) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) { reject(new Error('Kernel not connected')); return; }
      const msgId = crypto.randomUUID();
      pendingRef.current.set(msgId, { cellIndex, resolve });
      setCellStates(prev => ({ ...prev, [cellIndex]: { running: true, executionCount: null, outputs: [] } }));
      ws.send(JSON.stringify({
        header: { msg_id: msgId, msg_type: 'execute_request', username: 'quipu', session: sessionId ?? '', version: '5.3', date: new Date().toISOString() },
        parent_header: {}, metadata: {},
        content: { code: source, silent: false, store_history: true, user_expressions: {}, allow_stdin: false, stop_on_error: true },
        channel: 'shell', buffers: [],
      }));
    });
  }, [sessionId]);

  const runAll = useCallback(async () => {
    const cells = notebook?.cells ?? [];
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      if (cell.cell_type === 'code') {
        const source = joinSource(cell.source);
        if (source.trim()) try { await runCell(i, source); } catch (err) { showToast(`Cell ${i + 1}: ${(err as Error).message}`, 'error'); break; }
      }
    }
  }, [notebook, runCell, showToast]);

  const interruptKernel = useCallback(async () => {
    if (!kernelId) return;
    try { await kernelService.interruptKernel(kernelId); } catch (err) { showToast('Interrupt failed: ' + (err as Error).message, 'error'); }
  }, [kernelId, kernelService, showToast]);

  const restartKernel = useCallback(async () => {
    if (!kernelId) return;
    try { setKernelStatus('starting'); await kernelService.restartKernel(kernelId); setCellStates({}); showToast('Kernel restarted', 'success'); }
    catch (err) { showToast('Restart failed: ' + (err as Error).message, 'error'); }
  }, [kernelId, kernelService, showToast]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      if (detail === 'kernel.runAll') runAll();
      if (detail === 'kernel.interrupt') interruptKernel();
      if (detail === 'kernel.restart') restartKernel();
    };
    window.addEventListener('quipu:kernel-command', handler);
    return () => window.removeEventListener('quipu:kernel-command', handler);
  }, [runAll, interruptKernel, restartKernel]);

  const handleChangeVenv = useCallback(() => {
    if (sessionId) kernelService.closeSession(sessionId).catch(() => {});
    setVenvReady(false); setVenvInvalid(false); setKernelId(null); setSessionId(null); setCellStates({});
  }, [sessionId, kernelService]);

  if (error) return (
    <div className="h-full w-full flex items-center justify-center bg-bg-surface">
      <div className="text-text-tertiary text-sm text-center px-8">
        <div className="font-medium text-text-secondary mb-1">Cannot display notebook</div>
        <div>{error}</div>
      </div>
    </div>
  );

  if (!notebook) return null;

  const cells = notebook.cells ?? [];
  const language = inferLanguage(notebook);
  const isBusy = kernelStatus === 'busy' || kernelStatus === 'starting';

  return (
    <div className="h-full w-full flex flex-col overflow-hidden bg-bg-surface">
      <div className="shrink-0 flex items-center gap-3 px-4 py-2 bg-bg-elevated border-b border-border">
        <span className="text-text-secondary text-sm font-medium truncate mr-auto">{fileName}</span>
        <span className="text-text-tertiary text-xs shrink-0">{cells.length} {cells.length === 1 ? 'cell' : 'cells'}</span>
        {kernelId && (
          <div className="flex items-center gap-1 border-l border-border pl-3">
            <button onClick={runAll} disabled={isBusy} className="flex items-center gap-1 h-6 px-2 text-xs bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-40 transition-colors" title="Run all cells">
              <PlayIcon size={11} />Run All
            </button>
            <button onClick={interruptKernel} className="flex items-center justify-center h-6 w-6 text-xs bg-bg-elevated border border-border rounded text-text-secondary hover:text-text-primary transition-colors" title="Interrupt kernel"><SquareIcon size={11} /></button>
            <button onClick={restartKernel} className="flex items-center justify-center h-6 w-6 text-xs bg-bg-elevated border border-border rounded text-text-secondary hover:text-text-primary transition-colors" title="Restart kernel"><ArrowClockwiseIcon size={11} /></button>
          </div>
        )}
        <div className="shrink-0 flex items-center gap-2 border-l border-border pl-3">
          {venvReady ? (
            <>
              {kernelStarting ? <span className="text-text-tertiary text-xs">Starting kernel...</span> : <KernelStatusDot status={kernelStatus} />}
              <span className="text-text-tertiary text-xs truncate max-w-32" title={venvPath ?? undefined}>{venvPath?.split('/').pop() ?? venvPath}</span>
              <button onClick={handleChangeVenv} className="text-text-tertiary text-xs hover:text-text-primary">Change</button>
            </>
          ) : (
            <VenvSelector venvPath={venvPath} onSelect={handleSelectVenv} validating={validating} invalid={venvInvalid} />
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto py-4">
          {cells.length === 0 ? (
            <div className="text-text-tertiary text-sm text-center py-12">Empty notebook</div>
          ) : (
            cells.map((cell, i) => (
              <NotebookCell
                key={i}
                cell={cell}
                state={cellStates[i] ?? { running: false, executionCount: null, outputs: [] }}
                language={language}
                index={i}
                onRun={kernelId ? (idx, src) => runCell(idx, src).catch((err) => showToast((err as Error).message, 'error')) : (_idx, _src) => {}}
                onSourceChange={(_idx, _src) => {}}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default NotebookViewer;
