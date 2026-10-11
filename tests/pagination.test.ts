import { describe, it, expect } from "vitest";
import { fetchAllPages } from "../src/lib/pagination";

describe("complete Supabase reads", () => {
  it("loads more than 1000 rows even when the server returns smaller pages", async () => {
    const source = Array.from({ length: 1325 }, (_, id) => ({ id }));
    const requests: number[] = [];
    const result = await fetchAllPages(async (from, to) => {
      requests.push(from);
      return {
        data: source.slice(from, Math.min(to + 1, from + 200)),
        error: null,
      };
    });
    expect(result).toEqual(source);
    expect(requests).toEqual([0, 200, 400, 600, 800, 1000, 1200, 1325]);
  });
  it("does not silently return partial records after a failed page", async () => {
    await expect(
      fetchAllPages(async (from) =>
        from === 0
          ? { data: [1, 2], error: null }
          : { data: null, error: { message: "Connection lost" } },
      ),
    ).rejects.toThrow("Connection lost");
  });
});
