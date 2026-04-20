#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const commitMsgPath = process.argv[2];

if (!commitMsgPath) {
  console.error("✖ Missing commit message file path.");
  process.exit(1);
}

const rawMessage = readFileSync(commitMsgPath, "utf8");
const lines = rawMessage
  .split("\n")
  .filter((line) => !line.startsWith("#"))
  .map((line) => line.replace(/\r$/, ""));

const header = (lines[0] ?? "").trim();

if (header.startsWith("Merge ") || header.startsWith("Revert ")) {
  process.exit(0);
}

const subjectMatch = header.match(/^([a-z]+)(\(([^)]+)\))?:\s+(.+)$/);
const type = subjectMatch?.[1] ?? "";
const scope = subjectMatch?.[3] ?? "";
const subject = subjectMatch?.[4] ?? "";

const stagedFilesResult = spawnSync("git", ["diff", "--cached", "--name-only"], {
  encoding: "utf8",
});

if (stagedFilesResult.status !== 0) {
  console.error("✖ Unable to inspect staged files for commit message validation.");
  process.exit(1);
}

const stagedFiles = stagedFilesResult.stdout
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean);

const fileCount = stagedFiles.length;

const bodyLines = lines
  .slice(1)
  .map((line) => line.trimEnd())
  .filter((line) => line.trim().length > 0);

const bulletLines = bodyLines.filter((line) => /^- /.test(line));

const isReleaseVersionSubject = /^v?\d+\.\d+\.\d+([-.+][0-9A-Za-z.-]+)*$/.test(subject.trim());
const isReleaseCommit =
  type === "chore" && (scope.toLowerCase() === "release" || /^release\b/i.test(subject) || isReleaseVersionSubject);
const requiresDetailedBody = fileCount >= 4 && !isReleaseCommit;

if (requiresDetailedBody && (bulletLines.length < 2 || bulletLines.length > 4)) {
  console.error("✖ Multi-file commits must include 2-4 bullet points in commit body.");
  console.error(
    `  Found ${fileCount} staged files, but detected ${bulletLines.length} body bullet lines.`,
  );
  console.error("  Expected format:");
  console.error("  <type>: <short summary>");
  console.error("  ");
  console.error("  - bullet 1");
  console.error("  - bullet 2");
  console.error("  [- bullet 3]");
  console.error("  [- bullet 4]");
  process.exit(1);
}
