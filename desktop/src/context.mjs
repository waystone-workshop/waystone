export function rangeQuery(scope, selected) {
  if (scope !== "selection") return "";
  const ids = [...selected].sort((a, b) => a - b);
  if (!ids.length) throw new Error("Select at least one message first.");
  return `from=${ids[0]}&to=${ids.at(-1)}`;
}
export function mergeMessages(current, incoming) {
  return [
    ...new Map(
      [...current, ...incoming].map((message) => [message.id, message]),
    ).values(),
  ].sort((a, b) => a.id - b.id);
}
