import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { qk } from '../../api/keys';
import './build-version.css';

/** Fetch only when support details are opened; never label the server from the UI build. */
export function BuildVersion() {
  const { data, isPending, isError, isFetching, refetch } = useQuery({
    queryKey: qk.support.serverBuild,
    queryFn: () => api.get<{ buildHash: string }>('/health'),
    staleTime: 0,
    retry: false,
    networkMode: 'always',
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });
  return <div className="build-version" aria-live="polite">
    <span>Phiên bản máy chủ</span>
    {isPending ? <span>Đang kiểm tra…</span> : isError || !data?.buildHash
      ? <><span>Chưa đọc được</span><button type="button" disabled={isFetching} onClick={() => void refetch()}>Thử lại</button></>
      : <code>{data.buildHash}</code>}
  </div>;
}
