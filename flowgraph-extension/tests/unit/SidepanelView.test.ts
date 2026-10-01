import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CreateProjectDialog, formatTruncatedUuid, SidepanelView } from '../../src/ui/sidepanel/Sidepanel';
import { createSidepanelController } from '../../src/ui/sidepanel/controller';

describe('Sidepanel accessible view', () => {
  it('labels a created project retry as selection, not another creation', () => {
    const html = renderToStaticMarkup(React.createElement(CreateProjectDialog, {
      busy: false, locked: false, createdProject: { projectId: 'c', projectTitle: 'Created' },
      onClose: () => {}, onCreate: async () => {},
    }));
    expect(html).toContain('Thử chọn lại');
    expect(html).toContain('Đã tạo dự án');
    expect(html).not.toContain('id="sp-new-title"');
  });
  it('renders a labelled create dialog with optional bounded title and loading controls', () => {
    const render = (busy: boolean) => renderToStaticMarkup(React.createElement(CreateProjectDialog, {
      busy, locked: false, onClose: () => {}, onCreate: async () => {}, error: 'Provider unavailable',
    }));
    const html = render(false);
    for (const text of ['Tạo dự án mới', 'Tên dự án', '0/100', 'Hủy', 'Provider unavailable', 'aria-modal="true"', 'maxLength="100"']) expect(html).toContain(text);
    expect(html).not.toContain('required=""');
    expect(render(true)).toContain('Đang tạo');
    expect(render(true)).toContain('aria-busy="true"');
  });
  it('formats UUID into short 4...4 format', () => {
    expect(formatTruncatedUuid('4522d4f3-8f5c-49dc-ae2c-82e7cbcb664d')).toBe('4522...664d');
    expect(formatTruncatedUuid('short')).toBe('short');
    expect(formatTruncatedUuid('')).toBe('');
  });

  it('distinguishes an unloaded project list from a fetched empty list with a current project', async () => {
    const controller = createSidepanelController({ healthCheck: async () => ({ account: { state: 'CONNECTED' }, flow: { state: 'READY', projectId: 'current', title: 'Google Flow - Current project' } }),
      listProjects: async () => ({ projects: [], source: 'runtime' }),
      selectProject: async (projectId) => ({ projectId, selectedAt: '' }) }, async () => false);
    await controller.refresh();
    const render = () => renderToStaticMarkup(React.createElement(SidepanelView, {
      state: controller.getSnapshot(), controller, lastRun: null,
    }));

    expect(render()).toContain('Chưa tải danh sách dự án');
    expect(render()).not.toContain('Chưa có dự án');
    const work = controller.loadProjects();
    expect(render()).toContain('Đang tải danh sách dự án');
    await work;
    expect(render()).not.toContain('Chưa tải danh sách dự án');
    expect(render()).toContain('Chưa có dự án nào');
  });
  it('renders a dedicated connecting screen without disconnected or dashboard actions', () => {
    const controller = createSidepanelController({ healthCheck: async () => ({ account: { state: 'CONNECTED' }, flow: { state: 'READY' } }),
      listProjects: async () => ({ projects: [], source: 'runtime' }),
      selectProject: async (projectId) => ({ projectId, selectedAt: '' }) }, async () => false);
    const html = renderToStaticMarkup(React.createElement(SidepanelView, {
      state: controller.getSnapshot(), controller, lastRun: null, historyError: undefined,
    }));
    expect(html).toContain('Đang kết nối Google Flow...');
    expect(html).toContain('Đang phát hiện tab Google Flow và phiên làm việc...');
    expect(html).toContain('aria-live="polite"');
    expect(html).not.toContain('Mở Studio');
    expect(html).not.toContain('Visual AI Workflows');
  });
  it('shows the welcome CTA when disconnected and project cards when ready, without a Studio lock', async () => {
    const controller = createSidepanelController({
      healthCheck: async () => ({ account: { state: 'CONNECTED', email: 'artist@example.com' }, flow: { state: 'READY', projectId: 'project-one-1234' } }),
      listProjects: async () => ({ projects: [{ projectId: 'project-one-1234', projectTitle: 'Aurora', creationTime: '2026-01-02T00:00:00Z' }], source: 'runtime' }),
      selectProject: async projectId => ({ projectId, selectedAt: '' }),
    }, async () => true);
    const render = (state = controller.getSnapshot()) => renderToStaticMarkup(React.createElement(SidepanelView, { state, controller, lastRun: null }));
    const welcome = render({ ...controller.getSnapshot(), account: { state: 'DISCONNECTED' }, flow: { state: 'DISCONNECTED' } });
    expect(welcome).toContain('Workflow AI trực quan cho Google Flow');
    expect(welcome).toContain('Mở Google Flow');
    expect(welcome).not.toContain('Mở Studio');
    await controller.refresh(); await controller.loadProjects();
    const dashboard = render();
    for (const text of ['artist@example.com', 'Aurora', 'Đang chọn', 'Sao chép ID', 'Trang Flow', 'Tệp đã tải', 'Mở Studio', 'Tạo mới']) expect(dashboard).toContain(text);
    expect(dashboard).toMatch(/aria-label="Chọn dự án Aurora"/);
    expect(dashboard).not.toContain('disabled=""');
    expect(dashboard).not.toContain('đóng thẻ Studio');
    expect(dashboard).not.toContain('0 node');
    expect(render({ ...controller.getSnapshot(), running: true })).toMatch(/disabled=""[^>]*aria-label="Chọn dự án Aurora"/);
  });
  it('keeps an error visible after later info logs and labels unscoped history honestly', () => {
    const controller = createSidepanelController({ healthCheck: async () => ({ account: { state: 'CONNECTED' }, flow: { state: 'READY' } }),
      listProjects: async () => ({ projects: [], source: 'runtime' }),
      selectProject: async (projectId) => ({ projectId, selectedAt: '' }) }, async () => false);
    controller.runtimeEvent({ kind: 'run:error', error: { message: 'Provider error visible' } });
    controller.runtimeEvent({ kind: 'node:status', status: 'queued' });
    const html = renderToStaticMarkup(React.createElement(SidepanelView, {
      state: controller.getSnapshot(), controller, lastRun: { runId: 'r', projectId: 'other', status: 'unknown' },
    }));
    expect(html).toMatch(/role="alert"[^>]*>[^<]*Provider error visible/);
    expect(html).not.toContain('Lịch sử của dự án hiện tại');
  });
});
