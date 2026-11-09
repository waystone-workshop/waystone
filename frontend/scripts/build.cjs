const { build } = require("esbuild");
const { resolve } = require("node:path");
const { copyAssets } = require("@waystone-workshop/design-system");
async function main() {
  await build({ entryPoints:[resolve(__dirname,"../src/app.js")],bundle:true,format:"esm",outfile:resolve(__dirname,"../dist/app.js"),logLevel:"info" });
  copyAssets(resolve(__dirname,"../dist/design-system"));
}
main().catch(error=>{console.error(error);process.exitCode=1});
