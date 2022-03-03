#!/usr/bin/env zx

for (const arg in argv) {
  if (arg.includes("checkArgv")) {
    const list = argv[arg].split(",");
    list.forEach((item) => {
      if (!argv[item]) {
        const msg = `${item} is not defined`;
        throw new Error(msg);
      }
    });
  }
}
