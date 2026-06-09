#!/usr/bin/env bun
import { run } from "./cli/runner";

const res = await run(process.argv.slice(2));
if (res.stdout) process.stdout.write(res.stdout);
if (res.stderr) process.stderr.write(res.stderr);
process.exit(res.exitCode);
