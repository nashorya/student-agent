interface DataItem {
  id: string;
  value?: number;
  label: string;
}

const items: DataItem[] = [
  { id: "a1", value: 10, label: "first" },
  { id: "b2", value: undefined, label: "empty" },
  { id: "c3", value: 30, label: "third" },
];

function extractValues(data: DataItem[]): number[] {
  return data.map(r => r.value);
}

export { extractValues, items };
export type { DataItem };