import { expect, it, vi } from "vitest";
const remote = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../src/lib/supabase", () => ({ supabase: remote }));
import { getRecordExport } from "../src/lib/api";
const options = {
  page: 2,
  pageSize: 10,
  search: "sample",
  status: "all",
  sort: "grade",
  desc: true,
  term: 1,
};
it("exports all matching server pages in order and retains filters", async () => {
  remote.rpc.mockImplementation(async (_name, args) => ({
    error: null,
    data: {
      total: 205,
      learners: Array.from({ length: args.p_page === 2 ? 5 : 100 }, (_, i) => ({
        id: args.p_page * 100 + i,
      })),
      scores: [],
      termGrades: [],
      finalGrades: [],
    },
  }));
  const result = await getRecordExport("class", options);
  expect(result.learners).toHaveLength(205);
  expect(result.learners.map((l) => l.id)).toEqual(
    Array.from({ length: 205 }, (_, i) => i),
  );
  expect(remote.rpc.mock.calls.map((c) => c[1].p_page)).toEqual([0, 1, 2]);
  expect(
    remote.rpc.mock.calls.every(
      (c) =>
        c[1].p_size === 100 &&
        c[1].p_search === "sample" &&
        c[1].p_sort === "grade" &&
        c[1].p_desc,
    ),
  ).toBe(true);
});
it("rejects a failed page instead of silently producing a partial export", async () => {
  remote.rpc.mockReset();
  remote.rpc.mockResolvedValueOnce({
    data: {
      total: 101,
      learners: [],
      scores: [],
      termGrades: [],
      finalGrades: [],
    },
    error: null,
  });
  remote.rpc.mockResolvedValueOnce({
    data: null,
    error: { message: "Unable to fetch next page" },
  });
  await expect(getRecordExport("class", options)).rejects.toThrow(
    "Unable to fetch next page",
  );
});
