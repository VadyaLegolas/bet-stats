import { describe, expect, it } from "vitest";

import { createPrismaCalibrationRepository, type PrismaClient } from "@bet-stats/database";
import { calibratorContentDigest, calibratorContentId, type FittedCalibrator } from "@bet-stats/domain";

import { makeFitted } from "../helpers/calibration-db.js";

/**
 * WR-05: the calibrator content id covers the INPUTS of a fit (identity, market, method, config, samples), not its outputs
 * (parameters, holdout metrics). `createMany({ skipDuplicates })` keeps the old row on an id collision, so the repository must
 * prove that the kept row equals the fresh fit instead of silently serving different parameters than the ones decided on.
 */

type Row = Record<string, unknown>;

/** Minimal in-memory stand-in for the two `calibrator` model calls `persistCalibrator` makes; jsonb is emulated by a JSON round trip. */
function fakeClient(): { client: PrismaClient; rows: Map<string, Row> } {
  const rows = new Map<string, Row>();
  const calibrator = {
    async createMany({ data, skipDuplicates }: { data: Row[]; skipDuplicates?: boolean }) {
      let count = 0;
      for (const entry of data) {
        const id = entry.id as string;
        if (rows.has(id)) {
          if (!skipDuplicates) throw new Error("unique violation");
          continue;
        }
        rows.set(id, { ...entry, parameters: JSON.parse(JSON.stringify(entry.parameters)) as unknown });
        count += 1;
      }
      return { count };
    },
    async findUnique({ where }: { where: { id: string } }) {
      const row = rows.get(where.id);
      return row ? { ...row } : null;
    },
  };
  return { client: { calibrator } as unknown as PrismaClient, rows };
}

/** Deep copy with every object's keys in reverse insertion order (jsonb does not preserve key order either). */
function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reverseKeys(item)]));
  return value;
}

/** Same content id, different output: what a numeric fix in `fitPlatt` produces for unchanged data and unchanged config. */
function withDifferentParameters(fitted: FittedCalibrator): FittedCalibrator {
  if (fitted.method !== "PLATT") throw new Error("fixture must be Platt");
  const [scaler] = fitted.parameters.scalers;
  return { ...fitted, parameters: { ...fitted.parameters, scalers: [{ ...scaler!, slope: scaler!.slope + 0.25 }] } };
}

describe("persistCalibrator: a duplicate content id must carry identical content (WR-05)", () => {
  it("the content id alone does not see a changed fit output; the content digest does", () => {
    const fitted = makeFitted();
    const changed = withDifferentParameters(fitted);
    expect(calibratorContentId(changed)).toBe(calibratorContentId(fitted));
    expect(calibratorContentDigest(changed)).not.toBe(calibratorContentDigest(fitted));
    expect(calibratorContentDigest({ ...fitted, holdoutBrierCalibrated: fitted.holdoutBrierCalibrated + 1e-9 })).not.toBe(calibratorContentDigest(fitted));
  });

  it("the content digest ignores fittedAsOf and key order, as the content id does", () => {
    const fitted = makeFitted();
    const later: FittedCalibrator = { ...fitted, fittedAsOf: "2027-06-01T00:00:00.000Z" };
    const reordered = reverseKeys(fitted) as FittedCalibrator;
    expect(calibratorContentDigest(later)).toBe(calibratorContentDigest(fitted));
    expect(calibratorContentDigest(reordered)).toBe(calibratorContentDigest(fitted));
  });

  it("a second persist of the same fit, even at a later fittedAsOf, is a quiet no-op", async () => {
    const { client, rows } = fakeClient();
    const repository = createPrismaCalibrationRepository(client);
    const fitted = makeFitted();
    expect(await repository.persistCalibrator(fitted)).toEqual({ calibratorId: calibratorContentId(fitted), created: true });
    expect(await repository.persistCalibrator({ ...fitted, fittedAsOf: "2027-06-01T00:00:00.000Z" })).toEqual({ calibratorId: calibratorContentId(fitted), created: false });
    expect(rows.size).toBe(1);
  });

  it("a larger fit (isotonic considered) survives the jsonb round trip without a false mismatch", async () => {
    const { client } = fakeClient();
    const repository = createPrismaCalibrationRepository(client);
    const fitted = makeFitted({ count: 1700, seed: 909 });
    await repository.persistCalibrator(fitted);
    await expect(repository.persistCalibrator(fitted)).resolves.toMatchObject({ created: false });
  });

  it("a duplicate id with different parameters fails loudly and leaves the stored row untouched", async () => {
    const { client, rows } = fakeClient();
    const repository = createPrismaCalibrationRepository(client);
    const fitted = makeFitted();
    await repository.persistCalibrator(fitted);
    const before = JSON.stringify([...rows.values()]);
    await expect(repository.persistCalibrator(withDifferentParameters(fitted))).rejects.toMatchObject({ code: "CALIBRATOR_CONTENT_MISMATCH" });
    expect(JSON.stringify([...rows.values()])).toBe(before);
  });

  it("a duplicate id with different holdout metrics fails loudly", async () => {
    const { client } = fakeClient();
    const repository = createPrismaCalibrationRepository(client);
    const fitted = makeFitted();
    await repository.persistCalibrator(fitted);
    await expect(repository.persistCalibrator({ ...fitted, holdoutBrierCalibrated: fitted.holdoutBrierCalibrated - 0.01 })).rejects.toMatchObject({ code: "CALIBRATOR_CONTENT_MISMATCH" });
  });
});
