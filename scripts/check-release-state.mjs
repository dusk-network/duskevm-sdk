#!/usr/bin/env node

import { execFileSync } from "node:child_process";

const branch = git(["branch", "--show-current"]).trim();
if (branch !== "main") {
  throw new Error(`Releases must be published from main, not ${branch || "detached HEAD"}`);
}

const status = git(["status", "--porcelain"]);
if (status !== "") {
  throw new Error("Releases require a clean Git worktree and index");
}

console.log("Verified release source: clean main branch");

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" });
}
