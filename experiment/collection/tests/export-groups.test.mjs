import test from "node:test";
import assert from "node:assert/strict";
import { exportGroups } from "../scripts/export-groups.mjs";
test("researcher playthroughs stay downloadable but separate from participants, including incomplete sessions", () => {
  const sessions = [
    { participant_code: "adult-real", variant: "adult", status: "active", demographics: { study_year: "test" } },
    { participant_code: "child-real", variant: "child", status: "complete" },
    { participant_code: "researcher", variant: "adult", status: "active" },
    { participant_code: "smoke", variant: "child", status: "complete" },
  ];
  const original = structuredClone(sessions);
  const groups = exportGroups(sessions, [{ participant: "smoke" }], [{ participant: "researcher" }]);
  assert.deepEqual(groups.adult, [sessions[0]]);
  assert.deepEqual(groups.child, [sessions[1]]);
  assert.deepEqual(groups.researcher, [sessions[2]]);
  assert.deepEqual(sessions, original);
  assert.equal(exportGroups(sessions, []).adult.length, 2);
  assert.throws(() => exportGroups(sessions, [{ participant: "same" }], [{ participant: "same" }]), /Overlapping/);
});
