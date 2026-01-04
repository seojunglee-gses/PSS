const http = require("http");

http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("OK");
}).listen(5000, "0.0.0.0", () => {
  console.log("Server running on http://0.0.0.0:5000");
});
