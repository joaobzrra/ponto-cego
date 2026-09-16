import assert from "node:assert/strict";
import test from "node:test";

type Vote = { direction: "agree" | "disagree"; reviewed: boolean };

function queueAggregate(votes: Vote[]) {
  return {
    hasUnreviewed: votes.some((vote) => !vote.reviewed),
    agree: votes.filter((vote) => vote.direction === "agree").length,
    disagree: votes.filter((vote) => vote.direction === "disagree").length,
  };
}

test("queue eligibility does not erase reviewed positive evidence", () => {
  const result = queueAggregate([
    { direction: "agree", reviewed: true },
    { direction: "agree", reviewed: true },
    { direction: "disagree", reviewed: false },
  ]);
  assert.deepEqual(result, { hasUnreviewed: true, agree: 2, disagree: 1 });
});
