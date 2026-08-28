import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { listFavoritePacks, setPackFavorite } from "../native/scenarioPacks";
import { scenarioPackKeys } from "../queryKeys/scenarioPacks";

export function useFavoritePacks() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: scenarioPackKeys.favorites(),
    queryFn: listFavoritePacks,
  });

  const mutation = useMutation({
    mutationFn: ({ packId, favorite }: { packId: string; favorite: boolean }) =>
      setPackFavorite(packId, favorite),
    onSuccess: (favoriteIds) => {
      queryClient.setQueryData(scenarioPackKeys.favorites(), favoriteIds);
    },
  });

  const favoriteIds = query.data ?? [];

  const toggleFavorite = useCallback(
    (packId: string) => {
      mutation.mutate({ packId, favorite: !favoriteIds.includes(packId) });
    },
    [favoriteIds, mutation],
  );

  return {
    favoriteIds,
    isFavorite: (packId: string) => favoriteIds.includes(packId),
    toggleFavorite,
  };
}
