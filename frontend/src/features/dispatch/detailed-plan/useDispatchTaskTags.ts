import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createDispatchTaskTag, listDispatchTaskTags } from '../../../api/dispatchPlanningClient';
import { qk } from '../../../api/keys';

/**
 * Tag pool for the dispatch edit modal's note composer. Cached under
 * `qk.dispatchTaskTags.all` so an inline-add from one row's modal refreshes
 * the pool for every open modal; the list is tiny, so stale-while-revalidate
 * is free.
 */
export function useDispatchTaskTags() {
  const query = useQuery({
    queryKey: qk.dispatchTaskTags.all,
    queryFn: listDispatchTaskTags,
    staleTime: 60_000,
  });
  return {
    tags: query.data?.items ?? [],
    isLoading: query.isLoading,
    error: query.error,
  };
}

/** POST a new label; a duplicate (case/diacritics-insensitive) rejects with
 *  the backend's 409 so the caller can auto-select the existing chip. Also
 *  exposes the tag-query invalidation for the stale-pool 409 path. */
export function useCreateDispatchTaskTag() {
  const queryClient = useQueryClient();
  const invalidateTags = () => {
    void queryClient.invalidateQueries({ queryKey: qk.dispatchTaskTags.all });
  };
  const mutation = useMutation({
    mutationFn: (label: string) => createDispatchTaskTag(label),
    onSuccess: invalidateTags,
  });
  return {
    createTag: mutation.mutateAsync,
    invalidateTags,
    isCreating: mutation.isPending,
  };
}
