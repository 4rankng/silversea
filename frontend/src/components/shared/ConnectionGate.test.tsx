import { createPortal } from 'react-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectionGate } from './ConnectionGate';
import { AuthRecoveryGate } from './AuthRecoveryGate';
import { installChunkErrorHandler } from '../../lib/chunk-error';

const connection = vi.hoisted(() => ({ state: 'offline', retry: vi.fn(), logout: vi.fn() }));
vi.mock('../../hooks/useOnline', () => ({ useConnectionState: () => connection.state }));
vi.mock('../../lib/connection', () => ({ checkConnection: connection.retry }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ logout: connection.logout }) }));
let uninstallChunk: (() => void) | undefined;
afterEach(() => { uninstallChunk?.(); uninstallChunk = undefined; });

describe('connection gate across body portals', () => {
  beforeEach(() => { connection.state = 'offline'; vi.clearAllMocks(); });
  it('blocks pointer and keyboard actions without discarding drafts, then restores explicit interaction', async () => {
    const save = vi.fn();
    const content = <><input aria-label="Draft" defaultValue="unsaved value" />
      <button onClick={save}>Save</button>
      {createPortal(<button onClick={save} onKeyDown={save}>Portal save</button>, document.body)}</>;
    const page = render(<ConnectionGate>{content}</ConnectionGate>);
    expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('true');
    fireEvent.click(screen.getByText('Save'));
    fireEvent.click(screen.getByText('Portal save'));
    fireEvent.keyDown(screen.getByText('Portal save'), { key: 'Enter' });
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Thử lại kết nối'));
    expect(connection.retry).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByText('Đăng xuất'));
    expect(connection.logout).toHaveBeenCalledOnce();
    connection.state = 'online';
    page.rerender(<ConnectionGate>{content}</ConnectionGate>);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((screen.getByRole('textbox', { name: 'Draft' }) as HTMLInputElement).value).toBe('unsaved value');
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Portal save'));
    expect(save).toHaveBeenCalledOnce();
  });
  it.each(['connection-first', 'chunk-first'])('%s keeps one interactive recovery gate through reconnect and teardown', async (order) => {
    connection.state = order === 'chunk-first' ? 'online' : 'offline';
    const save = vi.fn();
    const content = <button onClick={save}>Save draft</button>;
    const page = render(<ConnectionGate>{content}</ConnectionGate>);
    uninstallChunk = installChunkErrorHandler();
    window.dispatchEvent(new Event('vite:preloadError', { cancelable: true }));
    await waitFor(() => expect(screen.getByText('Tải lại trang')).toBeInTheDocument());
    if (order === 'chunk-first') {
      connection.state = 'offline';
      page.rerender(<ConnectionGate>{content}</ConnectionGate>);
    }
    const chunk = document.querySelector<HTMLElement>('[data-chunk-error-panel]')!;
    const offline = document.querySelector<HTMLElement>('[aria-labelledby="connection-gate-title"]')!;
    expect(chunk.hasAttribute('inert')).toBe(false);
    expect(offline.hasAttribute('inert')).toBe(true);
    expect(offline.style.display).toBe('none');
    expect(chunk.style.display).not.toBe('none');
    fireEvent.click(screen.getByText('Save draft'));
    fireEvent.click(screen.getByText('Thử lại kết nối'));
    expect(save).not.toHaveBeenCalled();
    expect(connection.retry).not.toHaveBeenCalled();
    const retry = screen.getByText('Tải lại trang');
    fireEvent.keyDown(retry, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(retry);
    connection.state = 'online';
    page.rerender(<ConnectionGate>{content}</ConnectionGate>);
    expect(chunk.hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(retry);
    fireEvent.click(screen.getByText('Save draft'));
    expect(save).not.toHaveBeenCalled();
    uninstallChunk();
    uninstallChunk = undefined;
    fireEvent.click(screen.getByText('Save draft'));
    expect(save).toHaveBeenCalledOnce();
  });
  it('keeps auth recovery visible above connection and restores it after a higher-priority upgrade gate', async () => {
    const retry = vi.fn();
    const logout = vi.fn();
    const page = render(<><ConnectionGate><input aria-label="Draft" defaultValue="keep" /></ConnectionGate>
      <AuthRecoveryGate pending={false} retry={retry} logout={logout} /></>);
    const auth = document.querySelector<HTMLElement>('[aria-labelledby="auth-recovery-title"]')!;
    const offline = document.querySelector<HTMLElement>('[aria-labelledby="connection-gate-title"]')!;
    expect(auth.hasAttribute('inert')).toBe(false);
    expect(auth.style.display).not.toBe('none');
    expect(offline.style.display).toBe('none');
    fireEvent.click(screen.getByText('Thử lại'));
    expect(retry).toHaveBeenCalledOnce();
    uninstallChunk = installChunkErrorHandler();
    window.dispatchEvent(new Event('vite:preloadError', { cancelable: true }));
    await screen.findByText('Tải lại trang');
    expect(auth.style.display).toBe('none');
    expect(document.querySelector<HTMLElement>('[data-chunk-error-panel]')!.style.display).not.toBe('none');
    uninstallChunk();
    uninstallChunk = undefined;
    expect(auth.style.display).not.toBe('none');
    expect(auth.hasAttribute('inert')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Đăng xuất' }));
    expect(logout).toHaveBeenCalledOnce();
    page.unmount();
  });

  it('restores the connection controls when chunk recovery closes first', async () => {
    const page = render(<ConnectionGate><button>Save draft</button></ConnectionGate>);
    uninstallChunk = installChunkErrorHandler();
    window.dispatchEvent(new Event('vite:preloadError', { cancelable: true }));
    await waitFor(() => expect(screen.getByText('Tải lại trang')).toBeInTheDocument());
    uninstallChunk();
    uninstallChunk = undefined;
    expect(document.querySelector('[aria-labelledby="connection-gate-title"]')?.hasAttribute('inert')).toBe(false);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(screen.getByText('Đăng xuất'));
    fireEvent.click(screen.getByText('Thử lại kết nối'));
    expect(connection.retry).toHaveBeenCalledOnce();
    screen.getByText('Thử lại kết nối').focus();
    fireEvent.keyDown(screen.getByText('Thử lại kết nối'), { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByText('Đăng xuất'));
    fireEvent.keyDown(screen.getByText('Đăng xuất'), { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(screen.getByText('Thử lại kết nối'));
    page.unmount();
  });
});
