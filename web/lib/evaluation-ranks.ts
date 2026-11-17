export const TOP_RANKS = [1, 2, 3] as const;
export const isTopRank = (value: number) => TOP_RANKS.some(rank => rank === value);
/** Sanitize a new draft only; historical evaluation records are never rewritten. */
export function topRankSelection(rankings: Record<string, number>, imageIds: string[]): Record<string, number> {
  const selected: Record<string, number> = {};
  const used = new Set<number>();
  for (const id of imageIds) {
    const rank = rankings[id];
    if (isTopRank(rank) && !used.has(rank)) { selected[id] = rank; used.add(rank); }
  }
  return selected;
}
export function selectTopRank(rankings: Record<string, number>, imageId: string, value: string): Record<string, number> {
  const next = { ...rankings };
  if (!value) { delete next[imageId]; return next; }
  const rank = Number(value);
  if (!isTopRank(rank)) return next;
  for (const [id, selected] of Object.entries(next)) if (selected === rank) delete next[id];
  next[imageId] = rank;
  return next;
}
export function completeTopRanks(rankings: Record<string, number>, imageIds: string[]): boolean {
  const selected = Object.values(topRankSelection(rankings, imageIds));
  return imageIds.length > 0 && TOP_RANKS.slice(0, Math.min(3, imageIds.length)).every(rank => selected.includes(rank));
}
export function rankHeatmap(images: { id: string; label: string }[], results: { rankings: Record<string, number> }[]) {
  return images.map(image => ({ ...image, counts: TOP_RANKS.map(rank => results.filter(result => result.rankings?.[image.id] === rank).length) }));
}
export const HEATMAP_COLORS = ["#f1f5f9", "#d4e4f5", "#accbe8", "#78a9d6", "#306fad"];
export function heatmapLevel(count: number, maximum: number) {
  return count <= 0 || maximum <= 0 ? 0 : Math.max(1, Math.min(4, Math.ceil(count / maximum * 4)));
}

export type RankRow = ReturnType<typeof rankHeatmap>[number];
/** Read-only report projection: no weighted score or tie-breaking winner. */
export function evaluationReport(images: { id: string; label: string }[], results: { rankings: Record<string, number> }[]) {
  const rows = rankHeatmap(images, results);
  const maximumFirst = Math.max(0, ...rows.map(row => row.counts[0]));
  const winners = maximumFirst > 0 ? rows.filter(row => row.counts[0] === maximumFirst) : [];
  const distribution = rows.filter(row => row.counts.some(Boolean)).sort((a,b) =>
    b.counts[0]-a.counts[0] || b.counts[1]-a.counts[1] || b.counts[2]-a.counts[2]);
  const maximumTotal = Math.max(0, ...rows.map(row => row.counts.reduce((sum,count) => sum+count,0)));
  return { rows, winners, distribution, maximumTotal };
}
