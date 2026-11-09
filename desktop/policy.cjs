function validateServer(value) {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error(
      "Enter only the backend origin, such as https://mars.example.com",
    );
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local))
    throw new Error("Use HTTPS, or HTTP on localhost for development");
  return url.origin;
}
function validatePath(path) {
  if (
    typeof path !== "string" ||
    !/^\/api\/[a-zA-Z0-9/?=&_-]+$/.test(path) ||
    path.includes("..")
  )
    throw new Error("Invalid API path");
}
module.exports = { validateServer, validatePath };
