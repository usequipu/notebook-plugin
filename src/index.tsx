import React from 'react';
import type { PluginApi, KernelService, ViewerProps } from './plugin-types';
import NotebookViewer from './NotebookViewer';

export function init(api: PluginApi): void {
  const kernelSvc = api.services.kernelService as KernelService & {
    getVenvPath: () => Promise<unknown>;
    setVenvPath: (path: string) => Promise<void>;
  };

  function NotebookViewerPlugin(props: ViewerProps) {
    return (
      <NotebookViewer
        tab={props.tab}
        activeFile={props.activeFile ?? { name: props.tab.name, content: props.tab.content }}
        showToast={props.showToast}
        kernelService={kernelSvc}
      />
    );
  }

  api.register({
    id: 'notebook-plugin',
    canHandle: (_tab, activeFile) => (activeFile?.name ?? '').endsWith('.ipynb'),
    priority: 10,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    component: NotebookViewerPlugin as any,
  });

  api.commands.register('kernel.runAll', () => {
    window.dispatchEvent(new CustomEvent('quipu:kernel-command', { detail: 'kernel.runAll' }));
  }, { label: 'Run All Cells', category: 'Notebook' });

  api.commands.register('kernel.interrupt', () => {
    window.dispatchEvent(new CustomEvent('quipu:kernel-command', { detail: 'kernel.interrupt' }));
  }, { label: 'Interrupt Kernel', category: 'Notebook' });

  api.commands.register('kernel.restart', () => {
    window.dispatchEvent(new CustomEvent('quipu:kernel-command', { detail: 'kernel.restart' }));
  }, { label: 'Restart Kernel', category: 'Notebook' });
}
