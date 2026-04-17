import React from 'react';
import Ansi from 'ansi-to-react';
import DOMPurify from 'dompurify';

const OUTPUT_TRUNCATION_LIMIT = 100 * 1024;

const MIME_PRIORITY: string[] = [
  'text/html', 'image/png', 'image/svg+xml', 'image/jpeg', 'image/gif',
  'application/json', 'text/markdown', 'text/plain',
];

export type MimeData = Record<string, string | string[]>;

export interface NotebookOutput {
  output_type: 'stream' | 'display_data' | 'execute_result' | 'error';
  name?: string;
  text?: string | string[];
  data?: MimeData;
  metadata?: Record<string, unknown>;
  execution_count?: number | null;
  ename?: string;
  evalue?: string;
  traceback?: string | string[];
}

function pickMime(data: MimeData): string | null {
  for (const mime of MIME_PRIORITY) {
    if (data[mime] !== undefined) return mime;
  }
  return null;
}

function joinText(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value.join('');
  return String(value ?? '');
}

function truncate(text: string): { text: string; truncated: boolean } {
  if (text.length > OUTPUT_TRUNCATION_LIMIT) {
    return { text: text.slice(0, OUTPUT_TRUNCATION_LIMIT), truncated: true };
  }
  return { text, truncated: false };
}

function RichOutput({ data }: { data: MimeData }) {
  const mime = pickMime(data);
  if (!mime) return null;
  const raw = joinText(data[mime]);

  if (mime === 'text/html') {
    const clean = DOMPurify.sanitize(raw);
    return <div className="text-sm text-text-primary" dangerouslySetInnerHTML={{ __html: clean }} />;
  }
  if (mime.startsWith('image/')) {
    const src = mime === 'image/svg+xml'
      ? `data:image/svg+xml;base64,${btoa(raw)}`
      : `data:${mime};base64,${raw}`;
    return <img src={src} alt="output" className="max-w-full" />;
  }
  if (mime === 'application/json') {
    return <pre className="font-mono text-xs text-text-secondary overflow-x-auto">{JSON.stringify(JSON.parse(raw), null, 2)}</pre>;
  }
  const { text, truncated } = truncate(raw);
  return (
    <div>
      <pre className="font-mono text-xs text-text-primary whitespace-pre-wrap overflow-x-auto">{text}</pre>
      {truncated && <div className="text-xs text-text-tertiary mt-1">… (output truncated)</div>}
    </div>
  );
}

interface CellOutputProps { output: NotebookOutput }

function CellOutput({ output }: CellOutputProps) {
  if (output.output_type === 'stream') {
    const { text, truncated } = truncate(joinText(output.text));
    return (
      <div className="font-mono text-xs">
        <Ansi>{text}</Ansi>
        {truncated && <div className="text-xs text-text-tertiary">… (output truncated)</div>}
      </div>
    );
  }
  if (output.output_type === 'error') {
    const traceback = Array.isArray(output.traceback)
      ? output.traceback.join('\n')
      : String(output.traceback ?? '');
    const { text, truncated } = truncate(traceback);
    return (
      <div className="font-mono text-xs text-error">
        <div className="font-semibold">{output.ename}: {output.evalue}</div>
        <Ansi>{text}</Ansi>
        {truncated && <div className="text-xs text-text-tertiary">… (truncated)</div>}
      </div>
    );
  }
  if (output.data) {
    return <RichOutput data={output.data} />;
  }
  return null;
}

export default CellOutput;
