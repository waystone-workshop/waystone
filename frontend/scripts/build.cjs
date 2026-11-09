const { build } = require("esbuild");
const { resolve } = require("node:path");
const { copyAssets } = require("@waystone-workshop/design-system");
async function main() {
  const defaultServer = process.env.WAYSTONE_SERVER_URL || "http://localhost:4000";
  const server = new URL(defaultServer);
  if (server.protocol !== "https:" && !["localhost","127.0.0.1"].includes(server.hostname))
    throw new Error("Packaged remote server must use HTTPS.");
  await build({ entryPoints:[resolve(__dirname,"../src/app.js")],bundle:true,format:"esm",outfile:resolve(__dirname,"../dist/app.js"),logLevel:"info",
    define:{"process.env.WAYSTONE_SERVER_URL":JSON.stringify(defaultServer)} });
  copyAssets(resolve(__dirname,"../dist/design-system"));
}
main().catch(error=>{console.error(error);process.exitCode=1});
