import { beforeEach, describe, expect, it } from 'vitest';
import { setToken } from '../../design-system/hooks/useToken';
import { photoSrc } from './photo';

describe('photoSrc', () => {
  beforeEach(() => {
    setToken('test-token');
  });

  it('preserves a pending browser object URL for immediate preview', () => {
    const objectUrl = 'blob:https://vantai.tingting.vip/preview-id';

    expect(photoSrc(objectUrl)).toBe(objectUrl);
  });

  it('keeps persisted storage keys behind the authenticated photo route', () => {
    expect(photoSrc('trips/95/container-image.jpg')).toBe(
      '/api/photos/trips%2F95%2Fcontainer-image.jpg?token=test-token',
    );
  });
});
