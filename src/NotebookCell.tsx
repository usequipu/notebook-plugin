import React, { useMemo } from 'react';
import MonacoEditor from '@monaco-editor/react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { PlayIcon } from '@phosphor-icons/react';
import CellOutput from './CellOutput';
import type { NotebookOutput } from './CellOutput';

export interface NotebookCellData {
  cell_type: 'code' | 'markdown' | 'raw';
  source: string | string[];
  outputs?: NotebookOutput[];
  execution_count?: number | null;
  metadata?: Record<string, unknown>;
}

export interface Notebook {
  cells: NotebookCellData[];
  metadata?: {
    kernelspec?: { language?: string; name?: string; display_name?: string };
    language_info?: { name?: string };
    [key: string]: unknown;
  };
  nbformat?: number;
  nbformat_minor?: number;
}

export interface CellState {
  running: boolean;
  executionCount: number | null;
  outputs: NotebookOutput[];
}

export function joinSource(source: string | string[]): string {
  if (Array.isArray(source)) return source.join('');
  return String(source ?? '');
}

export function inferLanguage(notebook: Notebook): string {
  return notebook.metadata?.kernelspec?.language
    ?? notebook.metadata?.language_info?.name
    ?? 'python';
}

function ExecutionCount({ count, running }: { count: number | null; running: boolean }) {
  const label = running ? '[*]' : count == null ? '[ ]' : `[${count}]`;
  return (
    <div className="w-12 shrink-0 text-right text-text-tertiary text-xs font-mono pt-1 select-none pr-2">
      {label}
    </div>
  );
}

function MarkdownCell({ source }: { source: string }) {
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(source) as string), [source]);
  return (
    <div
      className="px-4 py-2 text-sm text-text-primary prose prose-invert max-w-none"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

interface NotebookCellProps {
  cell: NotebookCellData;
  state: CellState;
  language: string;
  index: number;
  onRun: (index: number, source: string) => void;
  onSourceChange: (index: number, source: string) => void;
}

function NotebookCell({ cell, state, language, index, onRun, onSourceChange }: NotebookCellProps) {
  const source = joinSource(cell.source);

  if (cell.cell_type === 'markdown') {
    return (
      <div className="border-b border-border/50">
        <MarkdownCell source={source} />
      </div>
    );
  }

  if (cell.cell_type === 'raw') {
    return (
      <div className="border-b border-border/50 px-4 py-2 font-mono text-xs text-text-tertiary whitespace-pre-wrap">
        {source}
      </div>
    );
  }

  // code cell
  return (
    <div className="border-b border-border/50">
      <div className="flex">
        <div className="flex flex-col items-center pt-1 px-1">
          <button
            onClick={() => onRun(index, source)}
            disabled={state.running}
            title="Run cell"
            className="w-6 h-6 flex items-center justify-center rounded text-text-tertiary hover:text-accent hover:bg-bg-elevated transition-colors disabled:opacity-40"
          >
            <PlayIcon size={12} weight="fill" />
          </button>
          <ExecutionCount count={state.executionCount} running={state.running} />
        </div>
        <div className="flex-1 min-w-0">
          <MonacoEditor
            height={Math.max(60, source.split('\n').length * 19 + 24)}
            language={language}
            value={source}
            onChange={(val) => onSourceChange(index, val ?? '')}
            theme="vs-dark"
            options={{
              minimap: { enabled: false },
              lineNumbers: 'off',
              folding: false,
              fontSize: 13,
              scrollBeyondLastLine: false,
              wordWrap: 'on',
              tabSize: 4,
              automaticLayout: true,
              overviewRulerLanes: 0,
              scrollbar: { vertical: 'hidden', horizontal: 'hidden', alwaysConsumeMouseWheel: false },
            }}
          />
        </div>
      </div>
      {state.outputs.length > 0 && (
        <div className="ml-14 border-t border-border/30 bg-bg-base p-3 space-y-1">
          {state.outputs.map((out, i) => <CellOutput key={i} output={out} />)}
        </div>
      )}
    </div>
  );
}

export default NotebookCell;
