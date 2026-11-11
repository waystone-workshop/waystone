const { build } = require("esbuild");
const { copyFile, mkdir } = require("node:fs/promises");
const { resolve } = require("node:path");
const { copyAssets } = require("@waystone-workshop/design-system");
async function main() {
  const defaultServer = process.env.WAYSTONE_SERVER_URL || "http://localhost:4000";
  const server = new URL(defaultServer);
  if (server.protocol !== "https:" && !["localhost","127.0.0.1"].includes(server.hostname))
    throw new Error("Packaged remote server must use HTTPS.");
  const dist = resolve(__dirname, "../dist");
  await mkdir(dist, { recursive: true });
  await build({ entryPoints:[resolve(__dirname,"../src/app.js")],bundle:true,format:"esm",outfile:resolve(dist,"app.js"),logLevel:"info",
    loader:{".wasm":"binary"},
    define:{"process.env.WAYSTONE_SERVER_URL":JSON.stringify(defaultServer)} });
  await copyFile(resolve(__dirname,"../node_modules/@sapphi-red/web-noise-suppressor/dist/rnnoise/workletProcessor.js"), resolve(dist,"rnnoise-worklet.js"));
  copyAssets(resolve(__dirname,"../dist/design-system"));
}
main().catch(error=>{console.error(error);process.exitCode=1});
