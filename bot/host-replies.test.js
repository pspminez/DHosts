import test from "node:test";
import assert from "node:assert/strict";
import { parseHostReply } from "./host-replies.js";

test("parses an escalation ID and host message", () => {
  assert.deepEqual(parseHostReply("#123 Please use the side entrance."), {
    id: 123,
    message: "Please use the side entrance.",
  });
});

test("rejects invalid IDs, empty messages, and oversized host replies", () => {
  assert.equal(parseHostReply("#0 message"), null);
  assert.equal(parseHostReply("#1"), null);
  assert.equal(parseHostReply("#1 " + "x".repeat(1201)), null);
});
