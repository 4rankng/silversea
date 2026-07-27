import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { photoViewerPropsMock, scannerPropsMock, setRowsMock, useTripFormContextMock } = vi.hoisted(() => ({
  photoViewerPropsMock: vi.fn(),
  scannerPropsMock: vi.fn(),
  setRowsMock: vi.fn(),
  useTripFormContextMock: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: undefined, isLoading: false }),
}));

vi.mock('../../hooks/useTripFormContext', () => ({
  useTripFormContext: useTripFormContextMock,
}));

vi.mock('../shared/Toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('../shared/ContainerScanner', () => ({
  ContainerScanner: (props: unknown) => {
    scannerPropsMock(props);
    return <div data-testid="container-scanner" />;
  },
  dataUrlToFile: vi.fn(() => ({ name: 'capture.jpg' })),
}));

vi.mock('../PhotoViewer', () => ({
  PhotoViewer: (props: unknown) => {
    photoViewerPropsMock(props);
    return <div data-testid="photo-viewer" />;
  },
}));

import { ContainerInstancesCard } from './ContainerInstancesCard';

describe('ContainerInstancesCard flat manifest layout', () => {
  beforeEach(() => {
    photoViewerPropsMock.mockReset();
    scannerPropsMock.mockReset();
    setRowsMock.mockReset();
    useTripFormContextMock.mockReturnValue({
      ocrResult: null,
      containerRows: [
        {
          _key: 'container-1',
          containerTypeId: '',
          containerNumber: 'LSQU1077373',
          sealNumber: '',
          cargoWeightKg: '',
          notes: '',
          seals: [],
          photoKeys: { cont: [], seal: [] },
        },
      ],
      setContainerRows: setRowsMock,
      uploadContainerPhoto: vi.fn(),
      revokeRowPhotos: vi.fn(),
      revokeContainerPhoto: vi.fn(),
      plannedContainerTypeId: '',
    });
  });

  it('renders one flat record with labelled fields and compact evidence rows', () => {
    const { container } = render(<ContainerInstancesCard expectedCount={1} />);

    expect(screen.getByRole('heading', { name: 'Container 01' })).toBeTruthy();
    expect((screen.getByLabelText(/Số container/) as HTMLInputElement).value).toBe('LSQU1077373');
    expect(screen.getByLabelText('Số seal 1')).toBeTruthy();
    expect(screen.getByLabelText('Ghi chú', { selector: '#seal-notes-container-1-0' })).toBeTruthy();
    expect(screen.getByLabelText('Trọng lượng (kg)')).toBeTruthy();
    expect(container.querySelectorAll('.ci-record')).toHaveLength(1);
    expect(container.querySelectorAll('.ci-detail-row')).toHaveLength(3);
    expect(container.querySelector('.ci-evidence-stack')).toBeNull();
  });

  it('keeps capture and destructive actions connected to the existing workflow', () => {
    render(<ContainerInstancesCard expectedCount={1} />);

    fireEvent.click(screen.getByRole('button', { name: 'Chụp ảnh container' }));
    expect(screen.getByTestId('container-scanner')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Xoá container 1' }));
    expect(setRowsMock).toHaveBeenCalled();
  });

  it('keeps seal 2 capture, OCR, and photo indexing connected', async () => {
    const context = useTripFormContextMock();
    context.uploadContainerPhoto.mockResolvedValue({
      url: 'blob:seal-2',
      ocrResult: { containerNumbers: [], sealNumber: 'seal002' },
      pending: true,
    });
    const { rerender } = render(<ContainerInstancesCard expectedCount={1} />);

    fireEvent.click(screen.getByRole('button', { name: 'Chụp ảnh seal 2' }));
    const scannerProps = scannerPropsMock.mock.calls.at(-1)?.[0] as { onCapture: (dataUrl: string) => Promise<void> };
    setRowsMock.mockClear();
    await act(() => scannerProps.onCapture('data:image/jpeg;base64,abc'));

    let nextRows = context.containerRows;
    for (const [updater] of setRowsMock.mock.calls) {
      if (typeof updater === 'function') nextRows = updater(nextRows);
    }
    expect(context.uploadContainerPhoto).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'capture.jpg' }),
      undefined,
      'container-1',
      'SEAL',
      undefined,
    );
    expect(nextRows[0].photoKeys.seal[1]).toBe('blob:seal-2');
    expect(nextRows[0].seals[1].sealNumber).toBe('SEAL002');

    useTripFormContextMock.mockReturnValue({ ...context, containerRows: nextRows });
    rerender(<ContainerInstancesCard expectedCount={1} />);
    expect(screen.queryByRole('button', { name: 'Mở ảnh seal 1' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Mở ảnh seal 2' })).toBeTruthy();
  });

  it('gives each populated seal photo a distinct view/delete name and opens the correct lightbox', () => {
    const context = useTripFormContextMock();
    useTripFormContextMock.mockReturnValue({
      ...context,
      containerRows: [
        {
          ...context.containerRows[0],
          seals: [
            { _key: 'seal-1', sealNumber: 'S1', notes: '' },
            { _key: 'seal-2', sealNumber: 'S2', notes: '' },
          ],
          photoKeys: { cont: [], seal: ['blob:seal-1', 'blob:seal-2'] },
        },
      ],
    });
    render(<ContainerInstancesCard expectedCount={1} />);

    expect(screen.getByRole('button', { name: 'Mở ảnh seal 1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Xoá ảnh seal 1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Xoá ảnh seal 2' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Mở ảnh seal 2' }));

    const viewerProps = photoViewerPropsMock.mock.calls.at(-1)?.[0] as { urls: string[]; initialIndex: number };
    expect(viewerProps.urls).toEqual(['blob:seal-2']);
    expect(viewerProps.initialIndex).toBe(0);
    expect(screen.getAllByRole('status').map((node) => node.textContent)).toEqual(['chưa lưu', 'chưa lưu']);
  });

  it('keeps add and clear-seal mutations scoped to the selected record', () => {
    const context = useTripFormContextMock();
    const populatedRows = [
      {
        ...context.containerRows[0],
        seals: [{ _key: 'seal-1', sealNumber: 'ABC123', notes: 'seal note' }],
      },
    ];
    useTripFormContextMock.mockReturnValue({ ...context, containerRows: populatedRows });
    render(<ContainerInstancesCard expectedCount={1} />);

    setRowsMock.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Xoá seal 1' }));
    const clearUpdater = setRowsMock.mock.calls.at(-1)?.[0] as (rows: typeof populatedRows) => typeof populatedRows;
    const cleared = clearUpdater(populatedRows);
    expect(cleared[0].seals[0].sealNumber).toBe('');

    fireEvent.click(screen.getByRole('button', { name: 'Thêm container' }));
    const addUpdater = setRowsMock.mock.calls.at(-1)?.[0] as (rows: typeof populatedRows) => typeof populatedRows;
    expect(addUpdater(populatedRows)).toHaveLength(2);
  });

  it('removes a pending seal photo without collapsing the other seal slot', () => {
    const context = useTripFormContextMock();
    const rowsWithPhotos = [
      {
        ...context.containerRows[0],
        photoKeys: { cont: [], seal: ['blob:seal-1', 'blob:seal-2'] },
      },
    ];
    useTripFormContextMock.mockReturnValue({ ...context, containerRows: rowsWithPhotos });
    render(<ContainerInstancesCard expectedCount={1} />);

    fireEvent.click(screen.getByRole('button', { name: 'Xoá ảnh seal 1' }));
    expect(context.revokeContainerPhoto).toHaveBeenCalledWith('container-1', 'SEAL', 'blob:seal-1');
    const deleteUpdater = setRowsMock.mock.calls.at(-1)?.[0] as (rows: typeof rowsWithPhotos) => typeof rowsWithPhotos;
    const updated = deleteUpdater(rowsWithPhotos);
    expect(updated[0].photoKeys.seal).toEqual(['', 'blob:seal-2']);
  });

  it('shows direct empty evidence guidance without an oversized drop zone', () => {
    const { container } = render(<ContainerInstancesCard expectedCount={1} />);

    expect(screen.getAllByText('Chưa có ảnh bằng chứng')).toHaveLength(3);
    expect(container.querySelector('.ci-photo-lane__drop')).toBeNull();
    expect(container.querySelectorAll('.ci-photo-lane__media')).toHaveLength(3);
  });

  it('replaces a failed thumbnail with a bounded recovery state', () => {
    useTripFormContextMock.mockReturnValue({
      ...useTripFormContextMock(),
      containerRows: [
        {
          ...useTripFormContextMock().containerRows[0],
          photoKeys: { cont: ['broken-photo.jpg'], seal: [] },
        },
      ],
    });

    render(<ContainerInstancesCard expectedCount={1} />);
    fireEvent.error(screen.getByAltText('Ảnh container LSQU1077373'));

    expect(screen.getByText('Không tải được')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Đổi ảnh container' })).toBeTruthy();
  });
});
