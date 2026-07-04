/**
 * デスクトップショートカット / CLI から Runner アプリを起動
 */
const { runRunnerItem } = require("./artifactRunner");

function parseArgs(argv) {
  const out = { owner: "", name: "" };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--owner" && argv[i + 1]) {
      out.owner = argv[++i];
    } else if (argv[i] === "--name" && argv[i + 1]) {
      out.name = argv[++i];
    }
  }
  return out;
}

async function runFromCli(argv = process.argv) {
  const { owner, name } = parseArgs(argv);
  if (!owner || !name) {
    throw new Error("usage: runner-launch.js --owner <owner> --name <name>");
  }
  const item = {
    owner,
    name,
    full_name: `${owner}/${name}`,
    fullName: `${owner}/${name}`,
    key: `${owner}/${name}`,
    local: owner === "local",
  };
  const log = (p) => console.log(p.message || p);
  const result = await runRunnerItem(item, log);
  console.log(`OK: ${result.fullName} (${result.entry})`);
  return result;
}

if (require.main === module) {
  runFromCli().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  runFromCli,
};
